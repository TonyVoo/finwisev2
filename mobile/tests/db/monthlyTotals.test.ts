import { migrate } from '@/db/migrations';
import { monthlyTotals } from '@/db/queries';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/** `monthlyTotals`: the trend chart's one read, against a real SQLite engine. */
describe('monthlyTotals', () => {
  let database: TestDatabase;
  const CAT = categoryId(1);

  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
    await seedCategory(database, { id: CAT, name: 'Food' });
  });
  afterEach(() => database.close());

  it('sums per month, inclusive of both ends, ignoring months outside the window', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: CAT,
      amountMinor: 100,
      date: '2026-05-01',
    });
    await seedExpense(database, {
      id: expenseId(2),
      categoryId: CAT,
      amountMinor: 250,
      date: '2026-05-31',
    });
    await seedExpense(database, {
      id: expenseId(3),
      categoryId: CAT,
      amountMinor: 7,
      date: '2026-10-31',
    });
    await seedExpense(database, {
      id: expenseId(4),
      categoryId: CAT,
      amountMinor: 999,
      date: '2026-04-30',
    });
    await seedExpense(database, {
      id: expenseId(5),
      categoryId: CAT,
      amountMinor: 999,
      date: '2026-11-01',
    });

    await expect(monthlyTotals(database, '2026-05', '2026-10')).resolves.toEqual([
      { month: '2026-05', totalMinor: 350 },
      { month: '2026-10', totalMinor: 7 },
    ]);
  });

  it('leaves out soft-deleted expenses, and months with nothing', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: CAT,
      amountMinor: 500,
      date: '2026-09-10',
      deletedAt: '2026-09-11T00:00:00.000Z',
    });
    await expect(monthlyTotals(database, '2026-05', '2026-10')).resolves.toEqual([]);
  });
});
