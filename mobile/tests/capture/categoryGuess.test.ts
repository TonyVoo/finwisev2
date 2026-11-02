import { guessCategory } from '@/capture/categoryGuess';
import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

const FOOD = categoryId(1);
const FUEL = categoryId(2);

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', color: '#2F8044' });
  await seedCategory(database, { id: FUEL, name: 'Fuel', color: '#B3261E' });
});

let n = 0;
const spend = (categoryId: string, note: string | null, extra: object = {}) =>
  seedExpense(database, {
    id: expenseId(++n),
    categoryId,
    amountMinor: 1000,
    date: '2026-10-05',
    note,
    ...extra,
  });

describe('guessing a category from what you filed the same name under', () => {
  it('has no guess for a name never seen', async () => {
    expect(await guessCategory(database, 'Circle K', 'expense')).toBeNull();
  });

  it('uses the category the name was filed under', async () => {
    await spend(FOOD, 'Circle K');
    expect(await guessCategory(database, 'Circle K', 'expense')).toBe(FOOD);
  });

  it('ignores case and surrounding spaces', async () => {
    await spend(FOOD, ' circle k ');
    expect(await guessCategory(database, 'CIRCLE K', 'expense')).toBe(FOOD);
  });

  it('prefers the category used most, and on a tie the most recent', async () => {
    await spend(FOOD, 'Shell');
    await spend(FUEL, 'Shell', { date: '2026-10-06' });
    await spend(FUEL, 'Shell', { date: '2026-10-07' });
    await spend(FOOD, 'Shell', { date: '2026-10-08' });
    expect(await guessCategory(database, 'Shell', 'expense')).toBe(FOOD);

    await spend(FUEL, 'Shell', { date: '2026-10-09' });
    expect(await guessCategory(database, 'Shell', 'expense')).toBe(FUEL);
  });

  it('ignores deleted entries, and entries of the other kind', async () => {
    await spend(FUEL, 'Shell', { deletedAt: '2026-10-06T00:00:00.000Z' });
    await spend(FOOD, 'Shell', { kind: 'income' });
    expect(await guessCategory(database, 'Shell', 'expense')).toBeNull();
  });

  it('has no guess without a name', async () => {
    await spend(FOOD, null);
    expect(await guessCategory(database, null, 'expense')).toBeNull();
    expect(await guessCategory(database, '  ', 'expense')).toBeNull();
  });
});
