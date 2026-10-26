import { createRecurring, deleteExpense, updateRecurring, deleteRecurring } from '@/db/mutations';
import { migrate } from '@/db/migrations';
import { generateDueRecurring } from '@/recurring/generate';
import { occurrenceExpenseId } from '@/recurring/schedule';
import { categoryId, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * The generator is the part of recurring expenses that touches money, so its guarantees are
 * pinned one by one: it creates what is due, creates it once, never brings back what the
 * user deleted, and files a rule whose category is gone under the fallback.
 */

const NOW = new Date(2026, 9, 26, 12, 0, 0); // 26 Oct 2026, local
const clock = () => NOW;
const RULE_ID = '0192f5a0-0000-7000-8000-0000000000aa';
const FOOD = categoryId(1);
const FALLBACK = categoryId(99);

interface ExpenseRowLite {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly date: string;
  readonly note: string | null;
  readonly deletedAt: string | null;
}

describe('generateDueRecurring', () => {
  let database: TestDatabase;

  const expenses = async (): Promise<readonly ExpenseRowLite[]> =>
    await database.getAllAsync<ExpenseRowLite>(
      'SELECT id, categoryId, amountMinor, currency, date, note, deletedAt FROM expenses ORDER BY date',
      [],
    );

  const addRule = async (
    overrides: Partial<Parameters<typeof createRecurring>[1]> = {},
    id = RULE_ID,
  ) =>
    await createRecurring(
      database,
      {
        categoryId: FOOD,
        amountMinor: 1299,
        currency: 'USD',
        note: 'Netflix',
        frequency: 'monthly',
        startDate: '2026-08-15',
        endDate: null,
        ...overrides,
      },
      { id, clock: () => new Date('2026-10-01T00:00:00.000Z') },
    );

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    await seedFallbackCategory(database, { id: FALLBACK });
    await seedCategory(database, { id: FOOD, name: 'Food' });
  });

  afterEach(() => database.close());

  it("creates every occurrence that is due, with the rule's fields", async () => {
    await addRule();

    const created = await generateDueRecurring(database, { clock });

    expect(created).toBe(3);
    expect(await expenses()).toEqual([
      expect.objectContaining({
        id: occurrenceExpenseId(RULE_ID, '2026-08-15'),
        categoryId: FOOD,
        amountMinor: 1299,
        currency: 'USD',
        date: '2026-08-15',
        note: 'Netflix',
        deletedAt: null,
      }),
      expect.objectContaining({ date: '2026-09-15' }),
      expect.objectContaining({ date: '2026-10-15' }),
    ]);
  });

  it('is idempotent: a second and third run create nothing and queue nothing', async () => {
    await addRule();
    await generateDueRecurring(database, { clock });
    const before = (await outboxEntries(database)).length;

    expect(await generateDueRecurring(database, { clock })).toBe(0);
    expect(await generateDueRecurring(database, { clock })).toBe(0);

    expect(await expenses()).toHaveLength(3);
    expect(await outboxEntries(database)).toHaveLength(before);
  });

  it('collapses two simultaneous runs into one, so a launch and a sync cannot double up', async () => {
    await addRule();

    const [a, b] = await Promise.all([
      generateDueRecurring(database, { clock }),
      generateDueRecurring(database, { clock }),
    ]);

    expect(a).toBe(3);
    expect(b).toBe(3); // the same pass, awaited twice - not a second pass
    expect(await expenses()).toHaveLength(3);
  });

  it('queues one outbox entry per created expense, each stamped with its occurrence date', async () => {
    await addRule();
    await generateDueRecurring(database, { clock });

    const expenseEntries = (await outboxEntries(database)).filter((e) => e.entity === 'expense');
    expect(expenseEntries).toHaveLength(3);

    const stamps = await database.getAllAsync<{ updatedAt: string }>(
      "SELECT updatedAt FROM outbox WHERE entity = 'expense' ORDER BY seq",
      [],
    );
    // Midnight UTC of the occurrence: any real edit or delete is newer, so generated rows
    // lose every last-write-wins tie.
    expect(stamps.map((s) => s.updatedAt)).toEqual([
      '2026-08-15T00:00:00.000Z',
      '2026-09-15T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
    ]);
  });

  it('does not bring back an expense the user deleted', async () => {
    await addRule();
    await generateDueRecurring(database, { clock });
    await deleteExpense(database, occurrenceExpenseId(RULE_ID, '2026-09-15'), {
      clock: () => new Date('2026-10-20T00:00:00.000Z'),
    });

    expect(await generateDueRecurring(database, { clock })).toBe(0);

    const rows = await expenses();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.date === '2026-09-15')?.deletedAt).not.toBeNull();
  });

  it('picks up the next occurrence when the date moves on, and only that one', async () => {
    await addRule();
    await generateDueRecurring(database, { clock });

    const created = await generateDueRecurring(database, {
      clock: () => new Date(2026, 10, 16, 8, 0, 0),
    });

    expect(created).toBe(1);
    expect((await expenses()).at(-1)?.date).toBe('2026-11-15');
  });

  it('creates nothing for a rule that starts in the future', async () => {
    await addRule({ startDate: '2026-12-01' });
    expect(await generateDueRecurring(database, { clock })).toBe(0);
    expect(await expenses()).toEqual([]);
  });

  it('stops at the end date', async () => {
    await addRule({ endDate: '2026-09-20' });
    expect(await generateDueRecurring(database, { clock })).toBe(2);
    expect((await expenses()).map((e) => e.date)).toEqual(['2026-08-15', '2026-09-15']);
  });

  it('does nothing for a deleted rule, and keeps what it already made', async () => {
    await addRule();
    await generateDueRecurring(database, { clock });
    await deleteRecurring(database, RULE_ID, { clock: () => new Date('2026-10-26T00:00:00.000Z') });

    expect(await generateDueRecurring(database, { clock: () => new Date(2027, 0, 1) })).toBe(0);
    expect(await expenses()).toHaveLength(3);
  });

  it('changing the amount affects future expenses, never the ones already created', async () => {
    await addRule();
    await generateDueRecurring(database, { clock });
    await updateRecurring(
      database,
      RULE_ID,
      { amountMinor: 1599 },
      {
        clock: () => new Date('2026-10-26T00:00:00.000Z'),
      },
    );

    await generateDueRecurring(database, { clock: () => new Date(2026, 10, 16) });

    expect((await expenses()).map((e) => e.amountMinor)).toEqual([1299, 1299, 1299, 1599]);
  });

  it("files under the fallback category when the rule's category was deleted", async () => {
    await addRule();
    await database.runAsync(
      "UPDATE categories SET deletedAt = '2026-10-01T00:00:00.000Z' WHERE id = ?",
      [FOOD],
    );

    await generateDueRecurring(database, { clock });

    expect((await expenses()).every((e) => e.categoryId === FALLBACK)).toBe(true);
  });

  it('leaves the rule for later when there is nowhere to file it', async () => {
    await database.runAsync('DELETE FROM categories', []);
    await addRule();

    expect(await generateDueRecurring(database, { clock })).toBe(0);

    await seedFallbackCategory(database, { id: FALLBACK });
    expect(await generateDueRecurring(database, { clock })).toBe(3);
  });

  it('keeps two rules apart even on the same dates', async () => {
    await addRule({}, RULE_ID);
    await addRule({ note: 'Gym', amountMinor: 3000 }, '0192f5a0-0000-7000-8000-0000000000bb');

    expect(await generateDueRecurring(database, { clock })).toBe(6);
    const rows = await expenses();
    expect(new Set(rows.map((r) => r.id)).size).toBe(6);
  });

  it('handles a month-end rule across February without drifting', async () => {
    await addRule({ startDate: '2026-01-31' });

    await generateDueRecurring(database, { clock });

    // 31 Oct is still ahead of the 26th, so the last one created is 30 Sep.
    expect((await expenses()).map((e) => e.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ]);
  });
});
