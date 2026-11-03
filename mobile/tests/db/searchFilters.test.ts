import { isSearchActive, searchExpenses, searchSummary, type ExpenseSearch } from '@/db/queries';
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
let database: TestDatabase;
let n = 0;

beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', color: '#2F8044' });
  const add = (amountMinor: number, date: string, extra: object = {}) =>
    seedExpense(database, { id: expenseId(++n), categoryId: FOOD, amountMinor, date, ...extra });
  await add(500, '2026-08-10');
  await add(2500, '2026-09-10');
  await add(12000, '2026-10-05');
  await add(90000, '2026-10-20', { kind: 'income' });
  await add(3000, '2026-10-21', { deletedAt: '2026-10-22T00:00:00.000Z' });
});

const base: ExpenseSearch = { text: '', categoryId: null };
const amounts = async (search: ExpenseSearch) =>
  (await searchExpenses(database, search)).map((row) => row.amountMinor).sort((a, b) => a - b);

describe('search filters', () => {
  it('counts each filter as a search', () => {
    expect(isSearchActive(base)).toBe(false);
    expect(isSearchActive({ ...base, kind: 'expense' })).toBe(true);
    expect(isSearchActive({ ...base, minMinor: 1 })).toBe(true);
    expect(isSearchActive({ ...base, maxMinor: 1 })).toBe(true);
    expect(isSearchActive({ ...base, from: '2026-10-01' })).toBe(true);
    expect(isSearchActive({ ...base, to: '2026-10-31' })).toBe(true);
  });

  it('filters by kind', async () => {
    expect(await amounts({ ...base, kind: 'income' })).toEqual([90000]);
    expect(await amounts({ ...base, kind: 'expense' })).toEqual([500, 2500, 12000]);
  });

  it('filters by amount, inclusive at both ends', async () => {
    expect(await amounts({ ...base, minMinor: 2500, maxMinor: 12000 })).toEqual([2500, 12000]);
    expect(await amounts({ ...base, minMinor: 10000 })).toEqual([12000, 90000]);
    expect(await amounts({ ...base, maxMinor: 500 })).toEqual([500]);
  });

  it('filters by date, inclusive at both ends', async () => {
    expect(await amounts({ ...base, from: '2026-09-10', to: '2026-10-05' })).toEqual([2500, 12000]);
    expect(await amounts({ ...base, from: '2026-10-01' })).toEqual([12000, 90000]);
    expect(await amounts({ ...base, to: '2026-08-31' })).toEqual([500]);
  });

  it('combines them, and never returns a deleted entry', async () => {
    const search = { ...base, kind: 'expense' as const, from: '2026-09-01', minMinor: 1000 };
    expect(await amounts(search)).toEqual([2500, 12000]);
  });

  it('totals only the spending among the matches', async () => {
    expect(await searchSummary(database, { ...base, from: '2026-10-01' })).toEqual({
      count: 2,
      totalMinor: 12000,
    });
  });
});
