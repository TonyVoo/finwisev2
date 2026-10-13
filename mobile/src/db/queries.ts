import type { CategoryRow } from './entities';
import type { SqliteDatabase } from './sqlite';

/**
 * Reads the UI renders from.
 *
 * These are local and synchronous-fast, which is the whole point of the architecture:
 * no screen in the app has a network loading state for reading data
 * (`docs/design/02-offline-and-sync.md` §1). A read here cannot fail because the phone
 * is in a tunnel, so there is no error path to design for.
 *
 * Feature screens land in later tasks; this module holds the reads the scaffold needs.
 */

/** A category as a screen consumes it: the row plus its local-only sync state. */
export interface CategoryListItem {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDefault: boolean;
  /**
   * True while an undrained outbox entry references this row. The outbox is the single
   * source of truth for `pending` (`docs/design/02-offline-and-sync.md` §2), so it is
   * derived here rather than stored as a column that could fall out of step.
   */
  readonly pending: boolean;
}

/**
 * Live categories in the order `docs/design/07-categories.md` §1 specifies: alphabetical
 * case-insensitively, with the `isDefault` row pinned last whatever it is called.
 *
 * Both halves of that `ORDER BY` are load-bearing and neither is visible on the seeded
 * six, where `Bills` … `Uncategorized` sort the same way under every candidate ordering
 * (`CAT-15`, `CAT-16`, GAP 12):
 *
 * - `COLLATE NOCASE`, because SQLite's default BINARY collation sorts every capital
 *   before every lowercase, so a user's `rent` would land after `Transport`.
 * - `isDefault` first, because the last row is also the one with no swipe action
 *   (§4 rule 4), and a protected row in the middle of the list reads as an arbitrary
 *   exception.
 *
 * Tombstoned rows are excluded. They stay in the table because sync needs to carry the
 * delete, but the UI must never show them.
 */
export async function listLiveCategories(
  database: SqliteDatabase,
): Promise<readonly CategoryListItem[]> {
  const rows = await database.getAllAsync<CategoryRow & { pending: number }>(
    `SELECT c.id,
            c.name,
            c.color,
            c.isDefault,
            EXISTS (
              SELECT 1 FROM outbox o WHERE o.entity = 'category' AND o.recordId = c.id
            ) AS pending
       FROM categories c
      WHERE c.deletedAt IS NULL
      ORDER BY c.isDefault, c.name COLLATE NOCASE`,
    [],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.isDefault === 1,
    pending: row.pending === 1,
  }));
}

/**
 * How many distinct records have undrained outbox entries.
 *
 * Distinct *records*, not entries: the sync pill reads "3 pending" as three expenses,
 * so three edits to one expense are one pending record
 * (`docs/design/02-offline-and-sync.md` §3 rule 5).
 */
export async function countPendingRecords(database: SqliteDatabase): Promise<number> {
  const row = await database.getFirstAsync<{ pending: number }>(
    'SELECT COUNT(DISTINCT entity || recordId) AS pending FROM outbox',
    [],
  );
  return row?.pending ?? 0;
}

/** A category plus the count the list and the delete dialog read. */
export interface CategoryWithCount extends CategoryListItem {
  /** Live expenses referencing it, every month. Zero renders as `0`. */
  readonly expenseCount: number;
}

/**
 * Live categories with the all-time expense count the category list shows.
 *
 * "All-time, not month-scoped" is the rule `07-categories.md` §1 rule 1 gives, and so is
 * the reason: the delete dialog promises "its {count} expenses will move", and a count
 * that silently meant "this month" would make that promise wrong (`CAT-09`).
 *
 * The count is a correlated subquery rather than a `LEFT JOIN ... GROUP BY` so a category
 * with no expenses still returns a row carrying `0` - which is what the column renders,
 * never a blank (§1 rule 2).
 */
export async function listLiveCategoriesWithCounts(
  database: SqliteDatabase,
): Promise<readonly CategoryWithCount[]> {
  const rows = await database.getAllAsync<CategoryRow & { pending: number; expenseCount: number }>(
    `SELECT c.id,
            c.name,
            c.color,
            c.isDefault,
            (
              SELECT COUNT(*) FROM expenses e
               WHERE e.categoryId = c.id AND e.deletedAt IS NULL
            ) AS expenseCount,
            EXISTS (
              SELECT 1 FROM outbox o WHERE o.entity = 'category' AND o.recordId = c.id
            ) AS pending
       FROM categories c
      WHERE c.deletedAt IS NULL
      ORDER BY c.isDefault, c.name COLLATE NOCASE`,
    [],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.isDefault === 1,
    pending: row.pending === 1,
    expenseCount: row.expenseCount,
  }));
}

/**
 * The live `isDefault` category - the reassignment target when a category is deleted.
 *
 * Resolved by the **flag**, never by matching the name "Uncategorized": rename is not
 * blocked, so the row may be called anything (`00-foundations.md` §7 note 3, `CAT-08`).
 * Returns null when the invariant is broken, which only a buggy or hostile peer can do;
 * `07-categories.md` §4 rule 9 holds the repair, and it is a repair rather than a reason
 * to block a delete.
 */
export async function findFallbackCategory(
  database: SqliteDatabase,
): Promise<CategoryListItem | null> {
  const row = await database.getFirstAsync<CategoryRow>(
    `SELECT id, name, color, isDefault FROM categories
      WHERE isDefault = 1 AND deletedAt IS NULL
      ORDER BY id
      LIMIT 1`,
    [],
  );
  if (row === null) return null;
  return { id: row.id, name: row.name, color: row.color, isDefault: true, pending: false };
}

/**
 * Whether a live category already uses `name`, compared case-insensitively after
 * trimming, optionally excluding one row.
 *
 * `exceptId` is what makes saving a category without changing its name not a conflict with
 * itself (`07-categories.md` §3 rule 1, `CAT-04`). A name matching a **deleted** category
 * is free: uniqueness is among live rows only, as the contract specifies (`CAT-02` step 3,
 * `CAT-14`).
 *
 * `id IS NOT ?` rather than `id <> ?`: with a NULL bound - the create case, which excludes
 * nothing - `<>` is NULL for every row and the query would match none of them, so a
 * duplicate name would sail through exactly where the check matters most.
 */
export async function isCategoryNameTaken(
  database: SqliteDatabase,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const row = await database.getFirstAsync<{ one: number }>(
    `SELECT 1 AS one FROM categories
      WHERE deletedAt IS NULL
        AND name = ? COLLATE NOCASE
        AND id IS NOT ?
      LIMIT 1`,
    [name.trim(), exceptId ?? null],
  );
  return row !== null;
}

/** How many live expenses reference a category, every month (`CAT-09`). */
export async function countCategoryExpenses(
  database: SqliteDatabase,
  categoryId: string,
): Promise<number> {
  const row = await database.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM expenses WHERE categoryId = ? AND deletedAt IS NULL',
    [categoryId],
  );
  return row?.n ?? 0;
}

/** Colours already worn by a live category, for the picker's `In use` labels. */
export async function coloursInUse(database: SqliteDatabase): Promise<readonly string[]> {
  const rows = await database.getAllAsync<{ color: string }>(
    'SELECT DISTINCT color FROM categories WHERE deletedAt IS NULL',
    [],
  );
  return rows.map((row) => row.color);
}

/** The inclusive calendar-date bounds of a month, as `monthRange` builds them. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** An expense as a list row consumes it: the row, its category, its local sync state. */
export interface ExpenseListItem {
  readonly id: string;
  readonly categoryId: string;
  /**
   * The live category's name, or null when `categoryId` resolves to nothing.
   *
   * Null is reachable rather than defensive: the server serves an expense whose category
   * is tombstoned (`SYNC-43`, GAP 15), and a pull delivers rows by revision, so a category
   * tombstone can arrive before the reassignment that follows it. The row renders under the
   * fallback category instead of failing the read (`migrations.ts`, note on
   * `expenses.categoryId`), which is why the fallback's name and colour come back on every
   * row.
   */
  readonly categoryName: string | null;
  readonly categoryColor: string | null;
  /** The live `isDefault` row's name and colour, for the case above. */
  readonly fallbackName: string | null;
  readonly fallbackColor: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly date: string;
  readonly note: string | null;
  readonly pending: boolean;
}

/** `WHERE` shared by a month's page and its total, so the two cannot disagree. */
const LIVE_IN_MONTH = 'e.deletedAt IS NULL AND e.date BETWEEN ? AND ?';

/**
 * One page of a month's expenses, newest day first.
 *
 * Three things the SQL is deliberate about:
 *
 * - **`deletedAt IS NULL`.** A soft-deleted expense is absent from the list exactly as a
 *   hard-deleted one would be; its row survives only so sync can carry the delete.
 * - **The bounds are the inclusive `YYYY-MM-DD` pair**, compared as text. No `Date` is
 *   involved, so no expense changes month because of where the device is (`SUM-02`).
 * - **`ORDER BY e.date DESC, e.id DESC`**, which is both the contract's own order for
 *   `GET /v1/expenses` and, because every id is a UUIDv7, creation order within a day - so
 *   a just-added expense appears at the top of its group (`04-expense-list.md` state
 *   `default`) without ordering on `createdAt`, which is NULL until a row has synced and
 *   would therefore sort a brand-new row *last* under `DESC`.
 */
export async function listMonthExpenses(
  database: SqliteDatabase,
  range: DateRange,
  page: { readonly limit: number; readonly offset?: number } = { limit: 50 },
): Promise<readonly ExpenseListItem[]> {
  const rows = await database.getAllAsync<Omit<ExpenseListItem, 'pending'> & { pending: number }>(
    `SELECT e.id,
            e.categoryId,
            e.amountMinor,
            e.currency,
            e.date,
            e.note,
            c.name  AS categoryName,
            c.color AS categoryColor,
            (SELECT f.name  FROM categories f
              WHERE f.isDefault = 1 AND f.deletedAt IS NULL
              ORDER BY f.id LIMIT 1) AS fallbackName,
            (SELECT f.color FROM categories f
              WHERE f.isDefault = 1 AND f.deletedAt IS NULL
              ORDER BY f.id LIMIT 1) AS fallbackColor,
            EXISTS (
              SELECT 1 FROM outbox o WHERE o.entity = 'expense' AND o.recordId = e.id
            ) AS pending
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
      WHERE ${LIVE_IN_MONTH}
      ORDER BY e.date DESC, e.id DESC
      LIMIT ? OFFSET ?`,
    [range.from, range.to, page.limit, page.offset ?? 0],
  );

  return rows.map((row) => ({ ...row, pending: row.pending === 1 }));
}

/**
 * A month's total, in minor units.
 *
 * `SUM(...)` over no rows is NULL, not 0, and both specs state the total renders `$0.00`
 * rather than a blank - so the coalesce is the client's to write (`SUM-19`). Summed as an
 * integer by SQLite and formatted once, never reduced over the rendered page, which would
 * be wrong the moment the list paginates (`SUM-01`).
 *
 * No join to `categories`: an expense whose category is tombstoned is still money the user
 * spent, so it still counts here (`SUM-17`).
 */
export async function monthTotalMinor(
  database: SqliteDatabase,
  range: DateRange,
): Promise<number> {
  const row = await database.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(e.amountMinor) AS total FROM expenses e WHERE ${LIVE_IN_MONTH}`,
    [range.from, range.to],
  );
  return row?.total ?? 0;
}

/**
 * How many live expenses a month holds.
 *
 * Separate from the total because the two answer different questions: a month of
 * zero-amount expenses totals `0` and is **not** empty (`SUM-18`), so the empty state
 * cannot be derived from the total.
 */
export async function monthExpenseCount(
  database: SqliteDatabase,
  range: DateRange,
): Promise<number> {
  const row = await database.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM expenses e WHERE ${LIVE_IN_MONTH}`,
    [range.from, range.to],
  );
  return row?.n ?? 0;
}

/**
 * Whether the user has any live expense at all, in any month.
 *
 * Separates Home's two empty states: "first run" teaches what the app is for, while
 * "nothing in this month" offers navigation to a user who already knows
 * (`04-expense-list.md` states `empty`, `SUM-06`).
 */
export async function anyExpensesExist(database: SqliteDatabase): Promise<boolean> {
  const row = await database.getFirstAsync<{ present: number }>(
    'SELECT EXISTS (SELECT 1 FROM expenses WHERE deletedAt IS NULL) AS present',
    [],
  );
  return row?.present === 1;
}

/**
 * Months holding at least one live expense, as `YYYY-MM` keys.
 *
 * `05-month-switcher.md` rule 9's query, which the picker grid's dots read. Bucketing with
 * `substr(date, 1, 7)` rather than `strftime` keeps it on the raw string: the two agree for
 * a well-formed `date`, and `substr` cannot reinterpret one that is not.
 */
export async function monthsWithExpenses(database: SqliteDatabase): Promise<readonly string[]> {
  const rows = await database.getAllAsync<{ ym: string }>(
    `SELECT substr(date, 1, 7) AS ym
       FROM expenses
      WHERE deletedAt IS NULL
      GROUP BY ym
      ORDER BY ym`,
    [],
  );
  return rows.map((row) => row.ym);
}

/** An expense as the form loads it. */
export interface ExpenseDetail {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly date: string;
  readonly note: string | null;
}

/**
 * One expense by id, for the form in edit mode.
 *
 * A tombstoned row answers null, the same as an absent one: both land on the `Expense not
 * found` state, because the row the user was offered to edit is gone either way
 * (`06-expense-form.md` state `error` (b)).
 */
export async function findExpense(
  database: SqliteDatabase,
  id: string,
): Promise<ExpenseDetail | null> {
  return await database.getFirstAsync<ExpenseDetail>(
    `SELECT id, categoryId, amountMinor, currency, date, note
       FROM expenses
      WHERE id = ? AND deletedAt IS NULL`,
    [id],
  );
}

/**
 * The category to preselect in add mode: the one on the most recently created expense.
 *
 * Read from SQLite rather than kept as a separate persisted preference, so it is correct
 * after a sync and needs no migration (`06-expense-form.md` rule 1). "Most recently
 * created" is `id DESC` over UUIDv7 keys - the same reasoning as the list order, and it
 * works for a row that has never synced and so has no `createdAt`.
 *
 * The join is what implements "if that category has since been deleted, fall back": a
 * deleted category is not a live row, so the most recent expense under one is skipped
 * rather than answered with an id the picker cannot show.
 */
export async function lastUsedCategoryId(database: SqliteDatabase): Promise<string | null> {
  const row = await database.getFirstAsync<{ categoryId: string }>(
    `SELECT e.categoryId
       FROM expenses e
       JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
      WHERE e.deletedAt IS NULL
      ORDER BY e.id DESC
      LIMIT 1`,
    [],
  );
  return row?.categoryId ?? null;
}
