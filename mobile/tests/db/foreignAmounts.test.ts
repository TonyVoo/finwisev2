import { migrate } from '@/db/migrations';
import { createExpense, updateExpense } from '@/db/mutations';
import {
  findExpense,
  listExpensesForExport,
  listMonthExpenses,
  monthTotalMinor,
} from '@/db/queries';
import { monthRange } from '@/lib/calendar';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * A foreign-currency expense stores `amountMinor` in the account currency - so every total,
 * budget and chart sums it unchanged - and the original amount and currency beside it.
 */

const CATEGORY = '0192f5a0-0000-7000-8000-000000000001';
const ID = '0192f5a0-0000-7000-8000-0000000000e1';
const OCTOBER = monthRange('2026-10');

describe('foreign-currency expenses, locally', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
       VALUES (?, 'Uncategorized', '#6B7280', 1, '2026-10-01T00:00:00.000Z', 1)`,
      [CATEGORY],
    );
  });
  afterEach(() => database.close());

  const base = { categoryId: CATEGORY, amountMinor: 1082, currency: 'USD', date: '2026-10-09' };

  it('defaults existing and ordinary rows to no original amount', async () => {
    await createExpense(database, base, { id: ID });
    const [item] = await listMonthExpenses(database, OCTOBER);
    expect(item).toMatchObject({ originalAmountMinor: null, originalCurrency: null });
  });

  it('stores the pair and queues it', async () => {
    await createExpense(
      database,
      { ...base, originalAmountMinor: 1000, originalCurrency: 'EUR' },
      { id: ID },
    );

    const [item] = await listMonthExpenses(database, OCTOBER);
    expect(item).toMatchObject({
      amountMinor: 1082,
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
    const detail = await findExpense(database, ID);
    expect(detail).toMatchObject({ originalAmountMinor: 1000, originalCurrency: 'EUR' });
    const entry = await database.getFirstAsync<{ fields: string }>('SELECT fields FROM outbox', []);
    expect(JSON.parse(entry!.fields)).toMatchObject({
      amountMinor: 1082,
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
  });

  it('sums the home amount, so a foreign expense counts in the account currency', async () => {
    await createExpense(database, base, { id: ID });
    await createExpense(
      database,
      { ...base, amountMinor: 500, originalAmountMinor: 450, originalCurrency: 'EUR' },
      { id: '0192f5a0-0000-7000-8000-0000000000e2' },
    );
    expect(await monthTotalMinor(database, OCTOBER)).toBe(1582);
  });

  it('can clear the pair, and can set it on an existing row', async () => {
    await createExpense(database, base, { id: ID });
    await updateExpense(database, ID, { originalAmountMinor: 1000, originalCurrency: 'EUR' });
    expect(await findExpense(database, ID)).toMatchObject({ originalCurrency: 'EUR' });

    await updateExpense(database, ID, { originalAmountMinor: null, originalCurrency: null });
    expect(await findExpense(database, ID)).toMatchObject({
      originalAmountMinor: null,
      originalCurrency: null,
    });
  });

  it('refuses half a pair before it is written', async () => {
    await expect(
      createExpense(database, { ...base, originalAmountMinor: 1000 } as never, { id: ID }),
    ).rejects.toThrow();
    expect(await database.getFirstAsync('SELECT 1 FROM expenses', [])).toBeNull();
  });

  it('refuses half a pair at rest, whatever wrote it', async () => {
    await expect(
      database.runAsync(
        `INSERT INTO expenses (id, categoryId, amountMinor, currency, originalAmountMinor, date, updatedAt)
         VALUES ('x', ?, 1, 'USD', 5, '2026-10-09', 'now')`,
        [CATEGORY],
      ),
    ).rejects.toThrow();
  });

  it('exports the original amount and currency', async () => {
    await createExpense(
      database,
      { ...base, originalAmountMinor: 1000, originalCurrency: 'EUR' },
      { id: ID },
    );
    const [row] = await listExpensesForExport(database);
    expect(row).toMatchObject({ originalAmountMinor: 1000, originalCurrency: 'EUR' });
  });
});
