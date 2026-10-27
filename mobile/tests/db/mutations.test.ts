import {
  CategoryNotDeletableError,
  CategoryNotFoundError,
  changedExpenseFields,
  createCategory,
  createExpense,
  deleteCategoryWithReassignment,
  deleteExpense,
  normaliseNote,
  restoreExpense,
  updateCategory,
  updateExpense,
} from '@/db/mutations';
import { migrate } from '@/db/migrations';
import {
  countCategoryExpenses,
  findExpense,
  listLiveCategoriesWithCounts,
  listMonthExpenses,
  monthTotalMinor,
} from '@/db/queries';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Covers `src/db/mutations.ts` - every write the expense and category screens make.
 *
 * Two assertions recur, and they are the two that matter most:
 *
 * - **Every write queued exactly one outbox entry per changed record.** A row written
 *   without its outbox entry is the worst bug this app can have: the user sees their
 *   expense saved, the screen is correct, and the change is simply never sent
 *   (`write.ts`). So each case checks the queue, not just the row.
 * - **A delete is a tombstone and is excluded from the list by the query**, not by the
 *   row being gone. A hard local delete cannot be synced as a delete.
 *
 * Everything runs against a real SQLite engine through the app's own port, so a rollback,
 * a `NOT NULL` and an `AUTOINCREMENT` behave as they do on a device (`tests/support/sqlite.ts`).
 */

const AT = new Date('2026-10-09T10:30:00.000Z');
const LATER = new Date('2026-10-09T11:00:00.000Z');

const ids = {
  groceries: '0192f5a0-0000-7000-8000-000000000001',
  transport: '0192f5a0-0000-7000-8000-000000000002',
  uncategorized: '0192f5a0-0000-7000-8000-000000000003',
  health: '0192f5a0-0000-7000-8000-000000000004',
  expenseA: '0192f5a0-0000-7000-8000-00000000000a',
  expenseB: '0192f5a0-0000-7000-8000-00000000000b',
  expenseC: '0192f5a0-0000-7000-8000-00000000000c',
} as const;

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

interface OutboxEntry {
  readonly seq: number;
  readonly entity: string;
  readonly recordId: string;
  readonly fields: string;
  readonly updatedAt: string;
  readonly clientMutationId: string;
}

describe('mutations', () => {
  let database: TestDatabase;
  let mutationId = 0;
  let clockAt = AT;

  const options = () => ({
    clock: () => clockAt,
    newMutationId: () =>
      `0192f5a0-0000-7000-8000-3000${(mutationId += 1).toString().padStart(8, '0')}`,
  });

  /** Rows as a sync pull leaves them: server revision, `createdAt` set, no outbox entry. */
  const pullCategory = async (
    id: string,
    name: string,
    isDefault = false,
    deletedAt: string | null = null,
  ): Promise<void> => {
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, deletedAt, revision)
       VALUES (?, ?, '#2F8044', ?, ?, ?, ?, 1)`,
      [id, name, isDefault ? 1 : 0, AT.toISOString(), AT.toISOString(), deletedAt],
    );
  };

  const pullExpense = async (
    id: string,
    categoryId: string,
    amountMinor: number,
    date = '2026-10-09',
    deletedAt: string | null = null,
  ): Promise<void> => {
    await database.runAsync(
      `INSERT INTO expenses (id, categoryId, amountMinor, currency, date, note, createdAt, updatedAt, deletedAt, revision)
       VALUES (?, ?, ?, 'USD', ?, NULL, ?, ?, ?, 1)`,
      [id, categoryId, amountMinor, date, AT.toISOString(), AT.toISOString(), deletedAt],
    );
  };

  const outbox = async (): Promise<readonly OutboxEntry[]> =>
    await database.getAllAsync<OutboxEntry>('SELECT * FROM outbox ORDER BY seq', []);

  const clearOutbox = async (): Promise<void> => {
    await database.runAsync('DELETE FROM outbox', []);
  };

  const row = async (
    table: 'expenses' | 'categories',
    id: string,
  ): Promise<Record<string, unknown> | null> =>
    await database.getFirstAsync(`SELECT * FROM ${table} WHERE id = ?`, [id]);

  beforeEach(async () => {
    database = createTestDatabase();
    mutationId = 0;
    clockAt = AT;
    await migrate(database);
    await pullCategory(ids.uncategorized, 'Uncategorized', true);
    await pullCategory(ids.groceries, 'Groceries');
  });

  afterEach(() => {
    database.close();
  });

  describe('adding an expense', () => {
    it('writes the row and queues exactly one outbox entry', async () => {
      const queued = await createExpense(
        database,
        {
          categoryId: ids.groceries,
          amountMinor: 1250,
          currency: 'USD',
          date: '2026-10-09',
          note: 'Milk, eggs',
        },
        { ...options(), id: ids.expenseA },
      );

      expect(queued).toMatchObject({ entity: 'expense', recordId: ids.expenseA, created: true });
      expect(await row('expenses', ids.expenseA)).toMatchObject({
        categoryId: ids.groceries,
        amountMinor: 1250,
        currency: 'USD',
        date: '2026-10-09',
        note: 'Milk, eggs',
        updatedAt: AT.toISOString(),
        deletedAt: null,
        // Never synced: `revision` 0 and no server `createdAt`.
        revision: 0,
        createdAt: null,
      });

      const queue = await outbox();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ entity: 'expense', recordId: ids.expenseA });
      expect(JSON.parse(queue[0]!.fields)).toEqual({
        categoryId: ids.groceries,
        kind: 'expense',
        amountMinor: 1250,
        currency: 'USD',
        date: '2026-10-09',
        note: 'Milk, eggs',
      });
    });

    /** `EXP-10`: the amount reaches the database as the integer the keypad held. */
    it('stores the amount as an integer number of minor units', async () => {
      await createExpense(
        database,
        { categoryId: ids.groceries, amountMinor: 1250, currency: 'USD', date: '2026-10-09' },
        { ...options(), id: ids.expenseA },
      );

      const stored = await row('expenses', ids.expenseA);
      expect(stored?.amountMinor).toBe(1250);
      expect(Number.isInteger(stored?.amountMinor)).toBe(true);
    });

    it('appears in the month list and the month total immediately', async () => {
      await createExpense(
        database,
        { categoryId: ids.groceries, amountMinor: 1250, currency: 'USD', date: '2026-10-09' },
        { ...options(), id: ids.expenseA },
      );

      const listed = await listMonthExpenses(database, OCTOBER);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        id: ids.expenseA,
        categoryName: 'Groceries',
        amountMinor: 1250,
        // The row the user just wrote is pending, because its outbox entry is undrained.
        pending: true,
      });
      expect(await monthTotalMinor(database, OCTOBER)).toBe(1250);
    });

    // `06-expense-form.md` rule 9: saving into another month is allowed, and the row then
    // does not appear in the month the user returns to - which is why the snackbar names it.
    it('is absent from a month it is not dated in', async () => {
      await createExpense(
        database,
        { categoryId: ids.groceries, amountMinor: 1250, currency: 'USD', date: '2026-09-29' },
        { ...options(), id: ids.expenseA },
      );

      expect(await listMonthExpenses(database, OCTOBER)).toEqual([]);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(0);
      expect(await monthTotalMinor(database, { from: '2026-09-01', to: '2026-09-30' })).toBe(1250);
    });

    it('stores a blank note as null rather than an empty string', async () => {
      await createExpense(
        database,
        {
          categoryId: ids.groceries,
          amountMinor: 500,
          currency: 'USD',
          date: '2026-10-09',
          note: '   ',
        },
        { ...options(), id: ids.expenseA },
      );

      expect((await row('expenses', ids.expenseA))?.note).toBeNull();
    });

    it('trims a note on the way in, matching the contract', async () => {
      await createExpense(
        database,
        {
          categoryId: ids.groceries,
          amountMinor: 500,
          currency: 'USD',
          date: '2026-10-09',
          note: '  Dinner with Sam  ',
        },
        { ...options(), id: ids.expenseA },
      );

      expect((await row('expenses', ids.expenseA))?.note).toBe('Dinner with Sam');
    });

    it('mints a different id for every expense when none is supplied', async () => {
      const first = await createExpense(
        database,
        { categoryId: ids.groceries, amountMinor: 100, currency: 'USD', date: '2026-10-09' },
        options(),
      );
      const second = await createExpense(
        database,
        { categoryId: ids.groceries, amountMinor: 200, currency: 'USD', date: '2026-10-09' },
        options(),
      );

      expect(first.recordId).not.toBe(second.recordId);
      expect(await listMonthExpenses(database, OCTOBER)).toHaveLength(2);
    });
  });

  describe('editing an expense', () => {
    beforeEach(async () => {
      await pullExpense(ids.expenseA, ids.groceries, 1250);
      await pullCategory(ids.transport, 'Transport');
    });

    /** `EXP-11`: Save is enabled by there being a change, and this is that computation. */
    it('reports no changed fields for a draft identical to the stored row', async () => {
      const stored = await findExpense(database, ids.expenseA);
      expect(
        changedExpenseFields(stored!, {
          categoryId: stored!.categoryId,
          kind: stored!.kind,
          amountMinor: stored!.amountMinor,
          currency: stored!.currency,
          originalAmountMinor: stored!.originalAmountMinor,
          originalCurrency: stored!.originalCurrency,
          date: stored!.date,
          note: stored!.note,
        }),
      ).toEqual({});
    });

    it('reports only the fields that differ', async () => {
      const stored = await findExpense(database, ids.expenseA);
      expect(
        changedExpenseFields(stored!, {
          categoryId: ids.transport,
          kind: stored!.kind,
          amountMinor: stored!.amountMinor,
          currency: stored!.currency,
          originalAmountMinor: stored!.originalAmountMinor,
          originalCurrency: stored!.originalCurrency,
          date: stored!.date,
          note: 'Bus fare',
        }),
      ).toEqual({ categoryId: ids.transport, note: 'Bus fare' });
    });

    // A note that is only whitespace is not a change from `null`: it normalises to `null`.
    it('does not report a whitespace-only note as a change from no note', async () => {
      const stored = await findExpense(database, ids.expenseA);
      expect(
        changedExpenseFields(stored!, {
          categoryId: stored!.categoryId,
          kind: stored!.kind,
          amountMinor: stored!.amountMinor,
          currency: stored!.currency,
          originalAmountMinor: stored!.originalAmountMinor,
          originalCurrency: stored!.originalCurrency,
          date: stored!.date,
          note: '   ',
        }),
      ).toEqual({});
    });

    it('writes only the changed columns and queues one entry carrying only them', async () => {
      clockAt = LATER;
      await updateExpense(database, ids.expenseA, { amountMinor: 1375 }, options());

      expect(await row('expenses', ids.expenseA)).toMatchObject({
        amountMinor: 1375,
        // Untouched by an amount edit, and `updatedAt` moved to the edit time.
        categoryId: ids.groceries,
        date: '2026-10-09',
        updatedAt: LATER.toISOString(),
      });

      const queue = await outbox();
      expect(queue).toHaveLength(1);
      expect(JSON.parse(queue[0]!.fields)).toEqual({ amountMinor: 1375 });
      expect(queue[0]!.updatedAt).toBe(LATER.toISOString());
    });

    it('clears a note by writing null, not an empty string', async () => {
      await updateExpense(database, ids.expenseA, { note: '' }, options());

      expect((await row('expenses', ids.expenseA))?.note).toBeNull();
      expect(JSON.parse((await outbox())[0]!.fields)).toEqual({ note: null });
    });

    it('moves an expense between months when its date changes', async () => {
      await updateExpense(database, ids.expenseA, { date: '2026-09-15' }, options());

      expect(await listMonthExpenses(database, OCTOBER)).toEqual([]);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(0);
      expect(await monthTotalMinor(database, { from: '2026-09-01', to: '2026-09-30' })).toBe(1250);
    });

    /**
     * `02-offline-and-sync.md` §2 rule 2 and `SYNC-04`: editing a pending row updates the
     * same row and queues a second entry. Two entries, one record - which is why the pill
     * counts distinct records rather than entries.
     */
    it('queues a second entry when an already-pending row is edited again', async () => {
      await updateExpense(database, ids.expenseA, { amountMinor: 1300 }, options());
      clockAt = LATER;
      await updateExpense(database, ids.expenseA, { note: 'Corrected' }, options());

      const queue = await outbox();
      expect(queue).toHaveLength(2);
      expect(queue.map((entry) => entry.recordId)).toEqual([ids.expenseA, ids.expenseA]);
      expect(queue.map((entry) => entry.clientMutationId)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
      expect(queue[0]!.clientMutationId).not.toBe(queue[1]!.clientMutationId);
    });
  });

  describe('deleting an expense', () => {
    beforeEach(async () => {
      await pullExpense(ids.expenseA, ids.groceries, 1250);
      await pullExpense(ids.expenseB, ids.groceries, 500);
    });

    /** `EXP-13`, and the acceptance criterion that a delete is soft. */
    it('stamps deletedAt rather than removing the row', async () => {
      await deleteExpense(database, ids.expenseA, options());

      expect(await row('expenses', ids.expenseA)).toMatchObject({
        deletedAt: AT.toISOString(),
        updatedAt: AT.toISOString(),
        // Still there: a hard delete cannot be synced as a delete.
        amountMinor: 1250,
      });
    });

    it('excludes the deleted row from the list and the total, and keeps the rest', async () => {
      await deleteExpense(database, ids.expenseA, options());

      const listed = await listMonthExpenses(database, OCTOBER);
      expect(listed.map((item) => item.id)).toEqual([ids.expenseB]);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(500);
    });

    it('queues the tombstone as one outbox entry', async () => {
      await deleteExpense(database, ids.expenseA, options());

      const queue = await outbox();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ entity: 'expense', recordId: ids.expenseA });
      expect(JSON.parse(queue[0]!.fields)).toEqual({ deletedAt: AT.toISOString() });
    });

    /** `EXP-13` step 2 and `EXP-14`: Undo is an ordinary update, with its own entry. */
    it('restores the row and queues a second entry', async () => {
      await deleteExpense(database, ids.expenseA, options());
      await clearOutbox(); // the delete has reached the server
      clockAt = LATER;

      await restoreExpense(database, ids.expenseA, options());

      expect(await row('expenses', ids.expenseA)).toMatchObject({
        deletedAt: null,
        updatedAt: LATER.toISOString(),
      });
      const queue = await outbox();
      expect(queue).toHaveLength(1);
      expect(JSON.parse(queue[0]!.fields)).toEqual({ deletedAt: null });

      const listed = await listMonthExpenses(database, OCTOBER);
      expect(listed.map((item) => item.id)).toContain(ids.expenseA);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(1750);
    });

    // `EXP-15`: two deletes stand independently. Undo is a UI affordance over the most
    // recent one, and nothing is held in memory waiting to be flushed.
    it('leaves both rows deleted when two are deleted in a row', async () => {
      await deleteExpense(database, ids.expenseA, options());
      await deleteExpense(database, ids.expenseB, options());
      await restoreExpense(database, ids.expenseB, options());

      expect((await row('expenses', ids.expenseA))?.deletedAt).toBe(AT.toISOString());
      expect((await row('expenses', ids.expenseB))?.deletedAt).toBeNull();
      expect((await outbox()).map((entry) => entry.recordId)).toEqual([
        ids.expenseA,
        ids.expenseB,
        ids.expenseB,
      ]);
    });
  });

  describe('creating a category', () => {
    it('writes the row with isDefault false and queues one entry', async () => {
      const queued = await createCategory(
        database,
        { name: '  Coffee  ', color: '#277573' },
        { ...options(), id: ids.health },
      );

      expect(queued.created).toBe(true);
      expect(await row('categories', ids.health)).toMatchObject({
        name: 'Coffee',
        color: '#277573',
        isDefault: 0,
        revision: 0,
        updatedAt: AT.toISOString(),
      });

      const queue = await outbox();
      expect(queue).toHaveLength(1);
      expect(JSON.parse(queue[0]!.fields)).toEqual({ name: 'Coffee', color: '#277573' });
    });

    it('shows up in the list with a zero count and pending true', async () => {
      await createCategory(
        database,
        { name: 'Coffee', color: '#277573' },
        { ...options(), id: ids.health },
      );

      const listed = await listLiveCategoriesWithCounts(database);
      expect(listed.find((category) => category.name === 'Coffee')).toMatchObject({
        expenseCount: 0,
        pending: true,
        isDefault: false,
      });
    });
  });

  describe('renaming a category', () => {
    beforeEach(async () => {
      await pullExpense(ids.expenseA, ids.groceries, 1250);
    });

    /** `CAT-03`: a rename must not touch a single expense. */
    it('changes the category and leaves every expense alone', async () => {
      const before = await row('expenses', ids.expenseA);

      await updateCategory(database, ids.groceries, { name: 'Food' }, options());

      expect((await row('categories', ids.groceries))?.name).toBe('Food');
      expect(await row('expenses', ids.expenseA)).toEqual(before);

      const queue = await outbox();
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ entity: 'category', recordId: ids.groceries });
      expect(JSON.parse(queue[0]!.fields)).toEqual({ name: 'Food' });
    });

    it('recolours without renaming', async () => {
      await updateCategory(database, ids.groceries, { color: '#BC4186' }, options());

      expect(await row('categories', ids.groceries)).toMatchObject({
        color: '#BC4186',
        name: 'Groceries',
      });
      expect(JSON.parse((await outbox())[0]!.fields)).toEqual({ color: '#BC4186' });
    });

    /** §3 rule 2: the `isDefault` category can be renamed. Only delete is guarded. */
    it('renames the default category', async () => {
      await updateCategory(database, ids.uncategorized, { name: 'Misc' }, options());

      expect(await row('categories', ids.uncategorized)).toMatchObject({
        name: 'Misc',
        isDefault: 1,
      });
    });
  });

  describe('deleting a category', () => {
    beforeEach(async () => {
      // `Groceries` holds three live expenses across two months plus one tombstoned.
      await pullExpense(ids.expenseA, ids.groceries, 1250, '2026-10-09');
      await pullExpense(ids.expenseB, ids.groceries, 500, '2026-09-20');
      await pullExpense(ids.expenseC, ids.groceries, 300, '2026-10-01');
      await pullExpense(
        '0192f5a0-0000-7000-8000-00000000000d',
        ids.groceries,
        900,
        '2026-10-02',
        AT.toISOString(),
      );
    });

    /** `CAT-05`: the expenses move. Losing them would be a P1 data-loss bug. */
    it('reassigns every live expense to the fallback and tombstones the category', async () => {
      clockAt = LATER;
      const result = await deleteCategoryWithReassignment(database, ids.groceries, options());

      expect(result).toMatchObject({
        movedCount: 3,
        fallbackId: ids.uncategorized,
        fallbackName: 'Uncategorized',
        fallbackRepaired: false,
      });
      expect((await row('categories', ids.groceries))?.deletedAt).toBe(LATER.toISOString());

      for (const id of [ids.expenseA, ids.expenseB, ids.expenseC]) {
        expect(await row('expenses', id)).toMatchObject({
          categoryId: ids.uncategorized,
          deletedAt: null,
          updatedAt: LATER.toISOString(),
        });
      }
      expect(await countCategoryExpenses(database, ids.uncategorized)).toBe(3);
      expect(await countCategoryExpenses(database, ids.groceries)).toBe(0);
    });

    it('leaves an already-tombstoned expense tombstoned and unmoved', async () => {
      await deleteCategoryWithReassignment(database, ids.groceries, options());

      expect(await row('expenses', '0192f5a0-0000-7000-8000-00000000000d')).toMatchObject({
        categoryId: ids.groceries,
        deletedAt: AT.toISOString(),
        // Untouched, so it does not cost a sync page for no visible reason.
        updatedAt: AT.toISOString(),
      });
    });

    /** §4 rule 6: one outbox entry per changed record - the category plus each expense. */
    it('queues one entry per changed record, categories before expenses', async () => {
      await deleteCategoryWithReassignment(database, ids.groceries, options());

      const queue = await outbox();
      expect(queue).toHaveLength(4);
      expect(queue[0]).toMatchObject({ entity: 'category', recordId: ids.groceries });
      expect(queue.slice(1).map((entry) => entry.entity)).toEqual([
        'expense',
        'expense',
        'expense',
      ]);
      expect(
        queue
          .slice(1)
          .map((entry) => entry.recordId)
          .sort(),
      ).toEqual([ids.expenseA, ids.expenseB, ids.expenseC].sort());
      // The reassignment pushes the expense's *new* categoryId, so a peer converges on the
      // same state without re-deriving it (`CAT-06`).
      expect(JSON.parse(queue[1]!.fields)).toEqual({ categoryId: ids.uncategorized });
      expect(JSON.parse(queue[0]!.fields)).toEqual({ deletedAt: AT.toISOString() });
    });

    it('gives every record its own idempotency key and one shared updatedAt', async () => {
      await deleteCategoryWithReassignment(database, ids.groceries, options());

      const queue = await outbox();
      expect(new Set(queue.map((entry) => entry.clientMutationId)).size).toBe(4);
      expect(new Set(queue.map((entry) => entry.updatedAt)).size).toBe(1);
    });

    it('removes the category from the list and keeps every expense in the totals', async () => {
      const octoberBefore = await monthTotalMinor(database, OCTOBER);
      await deleteCategoryWithReassignment(database, ids.groceries, options());

      expect(
        (await listLiveCategoriesWithCounts(database)).map((category) => category.name),
      ).toEqual(['Uncategorized']);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(octoberBefore);
      expect((await listMonthExpenses(database, OCTOBER)).map((item) => item.categoryName)).toEqual(
        ['Uncategorized', 'Uncategorized'],
      );
    });

    /** `CAT-10`: a category with no expenses deletes with a zero count. */
    it('deletes a category with no expenses, queueing one entry', async () => {
      await pullCategory(ids.health, 'Health');

      const result = await deleteCategoryWithReassignment(database, ids.health, options());

      expect(result.movedCount).toBe(0);
      expect(await outbox()).toHaveLength(1);
    });

    /** `CAT-07` / `CAT-12`: the fallback cannot be deleted, by any path. */
    it('refuses to delete the default category and writes nothing', async () => {
      await expect(
        deleteCategoryWithReassignment(database, ids.uncategorized, options()),
      ).rejects.toBeInstanceOf(CategoryNotDeletableError);

      expect((await row('categories', ids.uncategorized))?.deletedAt).toBeNull();
      expect(await outbox()).toEqual([]);
    });

    it('carries the fallback name on the refusal, for the snackbar', async () => {
      await updateCategory(database, ids.uncategorized, { name: 'Misc' }, options());
      await clearOutbox();

      await expect(
        deleteCategoryWithReassignment(database, ids.uncategorized, options()),
      ).rejects.toMatchObject({ fallbackName: 'Misc' });
    });

    /** `CAT-08`: the target is resolved by the flag, never by the name. */
    it('reassigns to the renamed default category', async () => {
      await updateCategory(database, ids.uncategorized, { name: 'Misc' }, options());
      await clearOutbox();

      const result = await deleteCategoryWithReassignment(database, ids.groceries, options());

      expect(result.fallbackName).toBe('Misc');
      expect((await row('expenses', ids.expenseA))?.categoryId).toBe(ids.uncategorized);
    });

    it('rejects a category that is already deleted, without writing', async () => {
      await pullCategory(ids.health, 'Health', false, AT.toISOString());

      await expect(
        deleteCategoryWithReassignment(database, ids.health, options()),
      ).rejects.toBeInstanceOf(CategoryNotFoundError);
      expect(await outbox()).toEqual([]);
    });

    /**
     * §4 rule 9. No live `isDefault` row is only reachable from a buggy or hostile peer,
     * and the client recreates the fallback rather than blocking the delete - and never
     * picks an arbitrary other category as the target.
     */
    it('recreates a missing fallback category rather than blocking', async () => {
      await database.runAsync('UPDATE categories SET deletedAt = ? WHERE isDefault = 1', [
        AT.toISOString(),
      ]);

      const result = await deleteCategoryWithReassignment(database, ids.groceries, options());

      expect(result.fallbackRepaired).toBe(true);
      expect(result.fallbackName).toBe('Uncategorized');
      expect(result.fallbackId).not.toBe(ids.uncategorized);
      expect(result.movedCount).toBe(3);

      const recreated = await row('categories', result.fallbackId);
      expect(recreated).toMatchObject({ isDefault: 1, deletedAt: null });
      expect((await row('expenses', ids.expenseA))?.categoryId).toBe(result.fallbackId);
    });

    /**
     * The whole operation is one transaction, so a failure part-way leaves no half-done
     * state: no reassignment without the tombstone, and no outbox entry for either.
     * Provoked by failing the write of the second expense.
     */
    it('rolls back every row and every entry when one write fails', async () => {
      let seen = 0;
      const failing = {
        ...database,
        withExclusiveTransactionAsync: (task: (txn: never) => Promise<void>) =>
          database.withExclusiveTransactionAsync(async (txn) => {
            await task({
              ...txn,
              runAsync: async (source: string, params: readonly unknown[]) => {
                if (source.includes('UPDATE expenses') && (seen += 1) === 2) {
                  throw new Error('disk full');
                }
                return await txn.runAsync(source, params as never);
              },
            } as never);
          }),
      };

      await expect(
        deleteCategoryWithReassignment(failing as never, ids.groceries, options()),
      ).rejects.toThrow('disk full');

      expect((await row('categories', ids.groceries))?.deletedAt).toBeNull();
      expect((await row('expenses', ids.expenseA))?.categoryId).toBe(ids.groceries);
      expect((await row('expenses', ids.expenseB))?.categoryId).toBe(ids.groceries);
      expect(await outbox()).toEqual([]);
    });
  });

  describe('normaliseNote', () => {
    it('is null for everything that carries no text', () => {
      expect(normaliseNote(null)).toBeNull();
      expect(normaliseNote(undefined)).toBeNull();
      expect(normaliseNote('')).toBeNull();
      expect(normaliseNote('   \n\t ')).toBeNull();
    });

    it('trims the edges and keeps the inside', () => {
      expect(normaliseNote('  Milk, eggs  ')).toBe('Milk, eggs');
      expect(normaliseNote('Milk,\neggs')).toBe('Milk,\neggs');
    });
  });
});
