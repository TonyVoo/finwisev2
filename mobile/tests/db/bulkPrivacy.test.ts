import { createExpense, deleteExpense, setExpensesPrivate } from '@/db/mutations';
import { findExpense } from '@/db/queries';
import { categoryId as catId, expenseId, createSyncDatabase } from '../support/sync';
import type { TestDatabase } from '../support/sqlite';

/**
 * Making many expenses private, or shared, in one go. Only what actually changes is written and
 * queued, so a mixed selection does not churn the ones already in the wanted state.
 */

const base = { categoryId: catId(1), amountMinor: 500, currency: 'USD', date: '2026-10-09' };

async function outboxFields(database: TestDatabase): Promise<readonly [string, unknown][]> {
  const rows = await database.getAllAsync<{ recordId: string; fields: string }>(
    "SELECT recordId, fields FROM outbox WHERE entity = 'expense' ORDER BY seq",
    [],
  );
  return rows.map((row) => [row.recordId, JSON.parse(row.fields)]);
}

describe('setExpensesPrivate', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createSyncDatabase();
    await createExpense(database, base, { id: expenseId(1) });
    await createExpense(database, { ...base, private: true }, { id: expenseId(2) });
    await createExpense(database, base, { id: expenseId(3) });
    await database.runAsync('DELETE FROM outbox', []);
  });
  afterEach(() => database.close());

  it('makes the chosen expenses private and returns the ones it changed', async () => {
    const changed = await setExpensesPrivate(database, [expenseId(1), expenseId(2)], true);

    expect(changed).toEqual([expenseId(1)]);
    expect((await findExpense(database, expenseId(1)))?.private).toBe(true);
    expect((await findExpense(database, expenseId(3)))?.private).toBe(false);
    const queued = await outboxFields(database);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.[0]).toBe(expenseId(1));
    expect(queued[0]?.[1]).toMatchObject({ private: true });
  });

  it('makes them shared again', async () => {
    const changed = await setExpensesPrivate(database, [expenseId(1), expenseId(2)], false);

    expect(changed).toEqual([expenseId(2)]);
    expect((await findExpense(database, expenseId(2)))?.private).toBe(false);
  });

  it('writes nothing when everything is already as asked', async () => {
    expect(await setExpensesPrivate(database, [expenseId(2)], true)).toEqual([]);
    expect(await outboxFields(database)).toEqual([]);
  });

  it('skips deleted and unknown expenses', async () => {
    await deleteExpense(database, expenseId(3));
    await database.runAsync('DELETE FROM outbox', []);

    const changed = await setExpensesPrivate(
      database,
      [expenseId(3), expenseId(9), expenseId(1)],
      true,
    );

    expect(changed).toEqual([expenseId(1)]);
  });

  it('is a no-op for an empty selection', async () => {
    expect(await setExpensesPrivate(database, [], true)).toEqual([]);
  });
});
