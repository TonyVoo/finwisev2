import { migrate } from '@/db/migrations';
import {
  lastUsedCategoryId,
  listExpensesForExport,
  listMonthExpenses,
  monthCategorySpend,
  monthIncomeMinor,
  monthTotalMinor,
  monthlyIncomeTotals,
  monthlyTotals,
  searchSummary,
} from '@/db/queries';
import { monthRange } from '@/lib/calendar';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Income shares the `expenses` table, so the property under test is negative: no spend
 * figure may include it. Each read is given a month holding both kinds.
 */

const AT = '2026-10-09T10:30:00.000Z';
const CATEGORY = '0192f5a0-0000-7000-8000-000000000001';
const OCTOBER = monthRange('2026-10');

describe('income is kept out of every spend total', () => {
  let database: TestDatabase;

  const insert = async (id: string, kind: 'expense' | 'income', amountMinor: number) => {
    await database.runAsync(
      `INSERT INTO expenses (id, categoryId, kind, amountMinor, currency, date, updatedAt, revision)
       VALUES (?, ?, ?, ?, 'USD', '2026-10-09', ?, 1)`,
      [id, CATEGORY, kind, amountMinor, AT],
    );
  };

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
       VALUES (?, 'Uncategorized', '#6B7280', 1, ?, 1)`,
      [CATEGORY, AT],
    );
    await insert('0192f5a0-0000-7000-8000-00000000000a', 'expense', 1000);
    await insert('0192f5a0-0000-7000-8000-00000000000b', 'income', 500000);
  });

  afterEach(() => {
    database.close();
  });

  it('defaults existing rows to expense', async () => {
    await database.runAsync(
      `INSERT INTO expenses (id, categoryId, amountMinor, currency, date, updatedAt, revision)
       VALUES ('x', ?, 1, 'USD', '2026-10-09', ?, 1)`,
      [CATEGORY, AT],
    );
    const row = await database.getFirstAsync<{ kind: string }>(
      "SELECT kind FROM expenses WHERE id = 'x'",
      [],
    );
    expect(row?.kind).toBe('expense');
  });

  it('rejects an unknown kind', async () => {
    await expect(
      database.runAsync(
        `INSERT INTO expenses (id, categoryId, kind, amountMinor, currency, date, updatedAt, revision)
         VALUES ('y', ?, 'gift', 1, 'USD', '2026-10-09', ?, 1)`,
        [CATEGORY, AT],
      ),
    ).rejects.toThrow();
  });

  it('totals spend without income, and income on its own', async () => {
    expect(await monthTotalMinor(database, OCTOBER)).toBe(1000);
    expect(await monthIncomeMinor(database, OCTOBER)).toBe(500000);
  });

  it('keeps income out of the category breakdown and the trend', async () => {
    const spend = await monthCategorySpend(database, OCTOBER);
    expect(spend.map((row) => [row.totalMinor, row.expenseCount])).toEqual([[1000, 1]]);
    expect(await monthlyTotals(database, '2026-10', '2026-10')).toEqual([
      { month: '2026-10', totalMinor: 1000 },
    ]);
  });

  it('totals income per month, and only income', async () => {
    expect(await monthlyIncomeTotals(database, '2026-10', '2026-10')).toEqual([
      { month: '2026-10', totalMinor: 500000 },
    ]);
  });

  it('lists both kinds, and totals only the spend of a search', async () => {
    const listed = await listMonthExpenses(database, OCTOBER);
    expect(listed.map((item) => item.kind).sort()).toEqual(['expense', 'income']);
    expect(await searchSummary(database, { text: '', categoryId: CATEGORY })).toEqual({
      count: 2,
      totalMinor: 1000,
    });
  });

  it('exports income with its kind', async () => {
    const rows = await listExpensesForExport(database);
    expect(rows.map((row) => [row.kind, row.amountMinor]).sort()).toEqual([
      ['expense', 1000],
      ['income', 500000],
    ]);
  });

  it('does not preselect a category from an income entry', async () => {
    await database.runAsync("DELETE FROM expenses WHERE kind = 'expense'", []);
    expect(await lastUsedCategoryId(database)).toBeNull();
  });
});
