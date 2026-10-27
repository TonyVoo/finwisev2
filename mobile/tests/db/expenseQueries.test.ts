import { migrate } from '@/db/migrations';
import {
  anyExpensesExist,
  coloursInUse,
  countCategoryExpenses,
  findExpense,
  findFallbackCategory,
  isCategoryNameTaken,
  lastUsedCategoryId,
  listLiveCategoriesWithCounts,
  listMonthExpenses,
  monthExpenseCount,
  monthTotalMinor,
  monthsWithExpenses,
} from '@/db/queries';
import { applyLocalMutation } from '@/db/write';
import { recordRejection } from '@/sync/rejections';
import { monthRange } from '@/lib/calendar';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Covers the reads `src/db/queries.ts` grew for the expense and category screens.
 *
 * The fixtures are chosen so a right answer and a wrong one look different - the failure
 * `CAT-01` was filed for. In particular every ordering case uses ids whose UUIDv7 order
 * disagrees with insertion order somewhere, and every month case puts rows on the month
 * boundary rather than mid-month.
 */

const AT = '2026-10-09T10:30:00.000Z';

/** UUIDv7s in ascending order, so "later id" means "created later". */
const ids = {
  uncategorized: '0192f5a0-0000-7000-8000-000000000001',
  groceries: '0192f5a0-0000-7000-8000-000000000002',
  transport: '0192f5a0-0000-7000-8000-000000000003',
  deleted: '0192f5a0-0000-7000-8000-000000000004',
  e1: '0192f5a0-0000-7000-8000-00000000000a',
  e2: '0192f5a0-0000-7000-8000-00000000000b',
  e3: '0192f5a0-0000-7000-8000-00000000000c',
  e4: '0192f5a0-0000-7000-8000-00000000000d',
} as const;

const OCTOBER = monthRange('2026-10');

interface SeedExpense {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly date?: string;
  readonly note?: string | null;
  readonly deletedAt?: string;
}

describe('expense and category reads', () => {
  let database: TestDatabase;

  const pullCategory = async (
    id: string,
    name: string,
    options: { isDefault?: boolean; deletedAt?: string; color?: string } = {},
  ): Promise<void> => {
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, deletedAt, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        name,
        options.color ?? '#2F8044',
        options.isDefault === true ? 1 : 0,
        AT,
        AT,
        options.deletedAt ?? null,
      ],
    );
  };

  const pullExpenses = async (...expenses: readonly SeedExpense[]): Promise<void> => {
    for (const expense of expenses) {
      await database.runAsync(
        `INSERT INTO expenses (id, categoryId, amountMinor, currency, date, note, createdAt, updatedAt, deletedAt, revision)
         VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, 1)`,
        [
          expense.id,
          expense.categoryId,
          expense.amountMinor,
          expense.date ?? '2026-10-09',
          expense.note ?? null,
          AT,
          AT,
          expense.deletedAt ?? null,
        ],
      );
    }
  };

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    await pullCategory(ids.uncategorized, 'Uncategorized', { isDefault: true, color: '#6B7280' });
    await pullCategory(ids.groceries, 'Groceries', { color: '#2F8044' });
  });

  afterEach(() => {
    database.close();
  });

  describe('listMonthExpenses', () => {
    it('returns a row with its category name, colour and sync state', async () => {
      await pullExpenses({
        id: ids.e1,
        categoryId: ids.groceries,
        amountMinor: 1250,
        note: 'Milk, eggs',
      });

      expect(await listMonthExpenses(database, OCTOBER)).toEqual([
        {
          id: ids.e1,
          categoryId: ids.groceries,
          kind: 'expense',
          categoryName: 'Groceries',
          categoryColor: '#2F8044',
          fallbackName: 'Uncategorized',
          fallbackColor: '#6B7280',
          amountMinor: 1250,
          currency: 'USD',
          originalAmountMinor: null,
          originalCurrency: null,
          date: '2026-10-09',
          note: 'Milk, eggs',
          pending: false,
          needsAttention: false,
        },
      ]);
    });

    /**
     * §5.1. The marker is derived from a rejection *and* an empty outbox, so the two
     * cases that matter are a refused row and one the user has since re-saved.
     */
    it('marks a row the server refused, and unmarks it once it is queued again', async () => {
      await pullExpenses({ id: ids.e1, categoryId: ids.groceries, amountMinor: 1250 });
      await recordRejection(database, {
        entity: 'expense',
        recordId: ids.e1,
        code: 'unknown_category',
        message: 'refused',
        rejectedAt: AT,
      });

      const [refused] = await listMonthExpenses(database, OCTOBER);
      expect(refused).toMatchObject({ pending: false, needsAttention: true });

      // Saving the repair re-queues the record, and a queued record is pending rather
      // than refused - nothing had to clear a flag.
      await applyLocalMutation(database, {
        entity: 'expense',
        id: ids.e1,
        fields: { categoryId: ids.groceries },
      });

      const [requeued] = await listMonthExpenses(database, OCTOBER);
      expect(requeued).toMatchObject({ pending: true, needsAttention: false });
    });

    /** `SUM-02`: the bounds are inclusive and compared as strings. */
    it('includes both boundary days and excludes the neighbouring months', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100, date: '2026-09-30' },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-01' },
        { id: ids.e3, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-31' },
        { id: ids.e4, categoryId: ids.groceries, amountMinor: 100, date: '2026-11-01' },
      );

      expect((await listMonthExpenses(database, OCTOBER)).map((item) => item.date)).toEqual([
        '2026-10-31',
        '2026-10-01',
      ]);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(200);
    });

    it('orders by date descending, then by id descending within a day', async () => {
      await pullExpenses(
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-09' },
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-09' },
        { id: ids.e3, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-10' },
      );

      expect((await listMonthExpenses(database, OCTOBER)).map((item) => item.id)).toEqual([
        ids.e3,
        ids.e2,
        ids.e1,
      ]);
    });

    /**
     * The ordering rule the design states as "`createdAt` descending, so a just-added
     * expense appears at the top of its group". A locally created row has no `createdAt`
     * yet - it is server-assigned - so ordering on that column would sort a brand-new row
     * *last* under `DESC`. The id is a UUIDv7, so it carries creation order already.
     */
    it('puts a locally created expense at the top of its day', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100 },
      );

      await applyLocalMutation(database, {
        entity: 'expense',
        id: ids.e3,
        fields: {
          categoryId: ids.groceries,
          amountMinor: 999,
          currency: 'USD',
          date: '2026-10-09',
        },
      });

      const listed = await listMonthExpenses(database, OCTOBER);
      expect(listed[0]).toMatchObject({ id: ids.e3, pending: true });
      expect(listed.slice(1).every((item) => item.pending === false)).toBe(true);
    });

    it('excludes a tombstoned expense', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100, deletedAt: AT },
      );

      expect((await listMonthExpenses(database, OCTOBER)).map((item) => item.id)).toEqual([ids.e1]);
    });

    /**
     * `SYNC-43` / GAP 15: the server serves an expense whose category is tombstoned, and a
     * pull can deliver a category tombstone before the reassignment behind it. The row has
     * to render, so the query answers "unresolved" and hands the screen the fallback's name
     * and colour to render it under.
     */
    it('reports an unresolvable category as null and still returns the row', async () => {
      await pullCategory(ids.deleted, 'Gone', { deletedAt: AT });
      await pullExpenses(
        { id: ids.e1, categoryId: ids.deleted, amountMinor: 31_250 },
        { id: ids.e2, categoryId: 'no-such-category', amountMinor: 1000 },
      );

      const listed = await listMonthExpenses(database, OCTOBER);
      expect(listed).toHaveLength(2);
      expect(listed.every((item) => item.categoryName === null)).toBe(true);
      expect(listed.every((item) => item.fallbackName === 'Uncategorized')).toBe(true);
      // `SUM-17`: it is still money the user spent, so it is still in the total.
      expect(await monthTotalMinor(database, OCTOBER)).toBe(32_250);
    });

    it('pages without overlapping or dropping a row', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e3, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e4, categoryId: ids.groceries, amountMinor: 100 },
      );

      const first = await listMonthExpenses(database, OCTOBER, { limit: 2 });
      const second = await listMonthExpenses(database, OCTOBER, { limit: 2, offset: 2 });

      expect(first.map((item) => item.id)).toEqual([ids.e4, ids.e3]);
      expect(second.map((item) => item.id)).toEqual([ids.e2, ids.e1]);
      expect(await listMonthExpenses(database, OCTOBER, { limit: 2, offset: 4 })).toEqual([]);
    });
  });

  describe('monthTotalMinor', () => {
    /** `SUM-19`: `SUM(...)` over no rows is NULL, and the screen must show `$0.00`. */
    it('is zero for an empty month, not null', async () => {
      expect(await monthTotalMinor(database, OCTOBER)).toBe(0);
    });

    /** `SUM-01`: the total is the whole month, not the page the list rendered. */
    it('sums every row in the month, past one page', async () => {
      for (let index = 0; index < 142; index += 1) {
        await pullExpenses({
          id: `0192f5a0-0000-7000-8000-1${index.toString().padStart(11, '0')}`,
          categoryId: ids.groceries,
          amountMinor: 101,
        });
      }

      expect(await listMonthExpenses(database, OCTOBER, { limit: 50 })).toHaveLength(50);
      expect(await monthTotalMinor(database, OCTOBER)).toBe(142 * 101);
    });

    it('excludes tombstoned rows', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 1000 },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 500, deletedAt: AT },
      );

      expect(await monthTotalMinor(database, OCTOBER)).toBe(1000);
    });

    /** `SUM-18`: a month of zero-amount expenses totals 0 and is not empty. */
    it('is zero for a month whose expenses all cost nothing, which is not empty', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 0 },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 0 },
      );

      expect(await monthTotalMinor(database, OCTOBER)).toBe(0);
      expect(await monthExpenseCount(database, OCTOBER)).toBe(2);
    });
  });

  describe('which months and whether any', () => {
    it('knows the difference between a first run and an empty month', async () => {
      expect(await anyExpensesExist(database)).toBe(false);

      await pullExpenses({
        id: ids.e1,
        categoryId: ids.groceries,
        amountMinor: 100,
        date: '2026-08-15',
      });

      expect(await anyExpensesExist(database)).toBe(true);
      expect(await monthExpenseCount(database, OCTOBER)).toBe(0);
    });

    it('counts a tombstoned-only database as having no expenses', async () => {
      await pullExpenses({
        id: ids.e1,
        categoryId: ids.groceries,
        amountMinor: 100,
        deletedAt: AT,
      });

      expect(await anyExpensesExist(database)).toBe(false);
    });

    /** `05-month-switcher.md` rule 9 - the dots on the picker grid. */
    it('lists the months holding live expenses, in order', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-31' },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100, date: '2025-12-01' },
        { id: ids.e3, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-01' },
        {
          id: ids.e4,
          categoryId: ids.groceries,
          amountMinor: 100,
          date: '2026-02-28',
          deletedAt: AT,
        },
      );

      expect(await monthsWithExpenses(database)).toEqual(['2025-12', '2026-10']);
    });
  });

  describe('findExpense', () => {
    it('reads the row the form prefills from', async () => {
      await pullExpenses({
        id: ids.e1,
        categoryId: ids.groceries,
        amountMinor: 1250,
        note: 'Milk',
      });

      expect(await findExpense(database, ids.e1)).toEqual({
        id: ids.e1,
        categoryId: ids.groceries,
        kind: 'expense',
        amountMinor: 1250,
        currency: 'USD',
        originalAmountMinor: null,
        originalCurrency: null,
        date: '2026-10-09',
        note: 'Milk',
      });
    });

    /** `06-expense-form.md` state `error` (b): absent and tombstoned are the same answer. */
    it('is null for an absent row and for a tombstoned one', async () => {
      await pullExpenses({
        id: ids.e2,
        categoryId: ids.groceries,
        amountMinor: 100,
        deletedAt: AT,
      });

      expect(await findExpense(database, ids.e1)).toBeNull();
      expect(await findExpense(database, ids.e2)).toBeNull();
    });
  });

  describe('lastUsedCategoryId', () => {
    it('is null before there are any expenses', async () => {
      expect(await lastUsedCategoryId(database)).toBeNull();
    });

    it('is the category of the most recently created expense', async () => {
      await pullCategory(ids.transport, 'Transport');
      await pullExpenses(
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e3, categoryId: ids.transport, amountMinor: 100, date: '2026-09-01' },
      );

      // `e3` has the later id, so it was created later - even though its calendar date is
      // earlier, which is exactly the case ordering on `date` would get wrong.
      expect(await lastUsedCategoryId(database)).toBe(ids.transport);
    });

    /** Rule 1: "if that category has since been deleted, fall back to the default". */
    it('skips an expense whose category has been deleted', async () => {
      await pullCategory(ids.deleted, 'Gone', { deletedAt: AT });
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e2, categoryId: ids.deleted, amountMinor: 100 },
      );

      expect(await lastUsedCategoryId(database)).toBe(ids.groceries);
    });

    it('ignores tombstoned expenses', async () => {
      await pullCategory(ids.transport, 'Transport');
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100 },
        { id: ids.e2, categoryId: ids.transport, amountMinor: 100, deletedAt: AT },
      );

      expect(await lastUsedCategoryId(database)).toBe(ids.groceries);
    });
  });

  describe('the fallback category', () => {
    it('is resolved by the flag, not by the name', async () => {
      await database.runAsync('UPDATE categories SET name = ? WHERE id = ?', [
        'Misc',
        ids.uncategorized,
      ]);

      expect(await findFallbackCategory(database)).toMatchObject({
        id: ids.uncategorized,
        name: 'Misc',
        isDefault: true,
      });
    });

    it('is null when no live row carries the flag', async () => {
      await database.runAsync('UPDATE categories SET deletedAt = ? WHERE isDefault = 1', [AT]);

      expect(await findFallbackCategory(database)).toBeNull();
    });
  });

  describe('category counts and names', () => {
    it('counts live expenses across every month, excluding tombstones', async () => {
      await pullExpenses(
        { id: ids.e1, categoryId: ids.groceries, amountMinor: 100, date: '2026-10-09' },
        { id: ids.e2, categoryId: ids.groceries, amountMinor: 100, date: '2026-08-01' },
        { id: ids.e3, categoryId: ids.groceries, amountMinor: 100, deletedAt: AT },
      );

      expect(await countCategoryExpenses(database, ids.groceries)).toBe(2);
      expect(await countCategoryExpenses(database, ids.uncategorized)).toBe(0);

      const listed = await listLiveCategoriesWithCounts(database);
      expect(listed.map((category) => [category.name, category.expenseCount])).toEqual([
        ['Groceries', 2],
        ['Uncategorized', 0],
      ]);
    });

    /** `CAT-02` / `CAT-14`: unique among live rows, case-insensitively, after trimming. */
    it('matches a taken name whatever its case or padding', async () => {
      expect(await isCategoryNameTaken(database, 'groceries')).toBe(true);
      expect(await isCategoryNameTaken(database, '  GROCERIES  ')).toBe(true);
      expect(await isCategoryNameTaken(database, 'Coffee')).toBe(false);
    });

    it('frees a name held only by a deleted category', async () => {
      await pullCategory(ids.deleted, 'Coffee', { deletedAt: AT });

      expect(await isCategoryNameTaken(database, 'Coffee')).toBe(false);
    });

    /** `CAT-04`: renaming a category to its own name is not a conflict with itself. */
    it('excludes the row being edited', async () => {
      expect(await isCategoryNameTaken(database, 'Groceries', ids.groceries)).toBe(false);
      expect(await isCategoryNameTaken(database, 'Groceries', ids.uncategorized)).toBe(true);
    });

    it('reports the colours a live category is already wearing', async () => {
      await pullCategory(ids.deleted, 'Gone', { color: '#BC4186', deletedAt: AT });

      const colours = await coloursInUse(database);
      expect(colours).toContain('#2F8044');
      expect(colours).toContain('#6B7280');
      expect(colours).not.toContain('#BC4186');
    });
  });
});
