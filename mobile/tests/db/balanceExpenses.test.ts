import { createExpense, deleteExpense } from '@/db/mutations';
import { listBalanceExpenses } from '@/db/queries';
import { categoryId as catId, expenseId, createSyncDatabase } from '../support/sync';
import type { TestDatabase } from '../support/sqlite';

/**
 * The rows settling up reads: live spending that is not private, with who added it and who paid.
 * Income, private expenses and deleted ones are not split, so they are not read at all.
 */

const base = { categoryId: catId(1), amountMinor: 500, currency: 'USD', date: '2026-10-09' };
const BAO = '0192f5a0-0000-7000-8000-00000000b001';

describe('listBalanceExpenses', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createSyncDatabase();
  });
  afterEach(() => database.close());

  it('returns what the engine needs, for an ordinary expense', async () => {
    await createExpense(database, { ...base, paidBy: BAO }, { id: expenseId(1) });
    await database.runAsync('UPDATE expenses SET createdBy = ? WHERE id = ?', [BAO, expenseId(1)]);

    expect(await listBalanceExpenses(database)).toEqual([
      {
        id: expenseId(1),
        amountMinor: 500,
        date: '2026-10-09',
        kind: 'expense',
        private: false,
        paidBy: BAO,
        createdBy: BAO,
      },
    ]);
  });

  it('leaves out income, private expenses and deleted ones', async () => {
    await createExpense(database, base, { id: expenseId(2) });
    await createExpense(database, { ...base, kind: 'income' }, { id: expenseId(3) });
    await createExpense(database, { ...base, private: true }, { id: expenseId(4) });
    await createExpense(database, base, { id: expenseId(5) });
    await deleteExpense(database, expenseId(5));

    expect((await listBalanceExpenses(database)).map((row) => row.id)).toEqual([expenseId(2)]);
  });

  it('is empty for a book with nothing in it', async () => {
    expect(await listBalanceExpenses(database)).toEqual([]);
  });
});
