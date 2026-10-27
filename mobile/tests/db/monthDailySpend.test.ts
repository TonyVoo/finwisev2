import { migrate } from '@/db/migrations';
import { monthDailySpend } from '@/db/queries';
import { monthRange } from '@/lib/calendar';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/** `monthDailySpend`: the Home sparkline's one read - spend per day, money out only. */
describe('monthDailySpend', () => {
  let database: TestDatabase;
  const CAT = categoryId(1);

  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
    await seedCategory(database, { id: CAT, name: 'Food' });
  });
  afterEach(() => database.close());

  it('sums each day, in date order, and leaves out days with nothing', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: CAT,
      amountMinor: 100,
      date: '2026-10-03',
    });
    await seedExpense(database, {
      id: expenseId(2),
      categoryId: CAT,
      amountMinor: 50,
      date: '2026-10-03',
    });
    await seedExpense(database, {
      id: expenseId(3),
      categoryId: CAT,
      amountMinor: 7,
      date: '2026-10-01',
    });

    await expect(monthDailySpend(database, monthRange('2026-10'))).resolves.toEqual([
      { date: '2026-10-01', totalMinor: 7 },
      { date: '2026-10-03', totalMinor: 150 },
    ]);
  });

  it('ignores other months, soft-deleted rows and income', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: CAT,
      amountMinor: 9,
      date: '2026-09-30',
    });
    await seedExpense(database, {
      id: expenseId(2),
      categoryId: CAT,
      amountMinor: 9,
      date: '2026-10-05',
      deletedAt: '2026-10-06T00:00:00.000Z',
    });
    await seedExpense(database, {
      id: expenseId(3),
      categoryId: CAT,
      amountMinor: 9,
      date: '2026-10-05',
      kind: 'income',
    });

    await expect(monthDailySpend(database, monthRange('2026-10'))).resolves.toEqual([]);
  });
});
