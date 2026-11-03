import { daySpendTotal } from '@/db/queries';
import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  await seedFallbackCategory(database);
  await seedCategory(database, { id: categoryId(1), name: 'Food', color: '#2F8044' });
  const add = (n: number, amountMinor: number, date: string, extra: object = {}) =>
    seedExpense(database, {
      id: expenseId(n),
      categoryId: categoryId(1),
      amountMinor,
      date,
      ...extra,
    });
  await add(1, 500, '2026-11-03');
  await add(2, 250, '2026-11-03');
  await add(3, 9999, '2026-11-02');
  await add(4, 70000, '2026-11-03', { kind: 'income' });
  await add(5, 111, '2026-11-03', { deletedAt: '2026-11-03T10:00:00.000Z' });
});

describe('what was spent on one day', () => {
  it('adds that day’s spending, leaving out income, deleted entries and other days', async () => {
    expect(await daySpendTotal(database, '2026-11-03')).toBe(750);
  });

  it('is zero for a day with nothing', async () => {
    expect(await daySpendTotal(database, '2026-11-04')).toBe(0);
  });
});
