import type { SyncEntity } from '@expense-tracker/shared';
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
  /** Monthly limit in minor units, or null for none. */
  readonly monthlyBudgetMinor: number | null;
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
            c.monthlyBudgetMinor,
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
    monthlyBudgetMinor: row.monthlyBudgetMinor,
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
            c.monthlyBudgetMinor,
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
    monthlyBudgetMinor: row.monthlyBudgetMinor,
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
    `SELECT id, name, color, isDefault, monthlyBudgetMinor FROM categories
      WHERE isDefault = 1 AND deletedAt IS NULL
      ORDER BY id
      LIMIT 1`,
    [],
  );
  if (row === null) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: true,
    monthlyBudgetMinor: row.monthlyBudgetMinor,
    pending: false,
  };
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
  readonly kind: 'expense' | 'income';
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
  /** What was actually paid, when not in `currency`: both or neither. */
  readonly originalAmountMinor: number | null;
  readonly originalCurrency: string | null;
  readonly date: string;
  readonly note: string | null;
  /** Who added it (the server's `createdBy`); null until the server answers, and for old rows. */
  readonly createdBy: string | null;
  readonly pending: boolean;
  /**
   * The server refused this row and nothing is queued for it any more
   * (`02-offline-and-sync.md` §5.1).
   *
   * Derived from `sync_rejections` and the outbox together, never stored on the row: the
   * marker clears itself when the user saves a repair, because that re-queues the record
   * and a queued record is `pending` rather than refused. Nothing has to remember to
   * clear a flag.
   */
  readonly needsAttention: boolean;
}

/** `WHERE` shared by a month's page and its total, so the two cannot disagree. */
const LIVE_IN_MONTH = 'e.deletedAt IS NULL AND e.date BETWEEN ? AND ?';

/**
 * Every spend total counts money out only. Income lives in the same table (migration 9), so
 * a query that sums `amountMinor` without this would add salary to the month's spending.
 */
const SPEND = "e.kind = 'expense'";

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
  return selectExpenseItems(database, LIVE_IN_MONTH, [range.from, range.to], page);
}

/**
 * The shared read behind the month list and search: same row shape, same ordering, same
 * pending/refused derivation, so a search result can never render differently from the row
 * it is a hit for. `where` is trusted SQL written in this file; every value is a parameter.
 */
async function selectExpenseItems(
  database: SqliteDatabase,
  where: string,
  params: readonly (string | number)[],
  page: { readonly limit: number; readonly offset?: number },
): Promise<readonly ExpenseListItem[]> {
  const rows = await database.getAllAsync<
    Omit<ExpenseListItem, 'pending' | 'needsAttention'> & {
      pending: number;
      rejected: number;
    }
  >(
    `SELECT e.id,
            e.categoryId,
            e.kind,
            e.amountMinor,
            e.currency,
            e.originalAmountMinor,
            e.originalCurrency,
            e.date,
            e.note,
            e.createdBy,
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
            ) AS pending,
            EXISTS (
              SELECT 1 FROM sync_rejections r
               WHERE r.entity = 'expense' AND r.recordId = e.id
            ) AS rejected
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
      WHERE ${where}
      ORDER BY e.date DESC, e.id DESC
      LIMIT ? OFFSET ?`,
    [...params, page.limit, page.offset ?? 0],
  );

  return rows.map(({ pending, rejected, ...row }) => ({
    ...row,
    pending: pending === 1,
    // Refused *and* not queued. A row the user has just re-saved is queued again, and the
    // design is explicit that saving the repair clears the marker (§5.1).
    needsAttention: rejected === 1 && pending !== 1,
  }));
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
export async function monthTotalMinor(database: SqliteDatabase, range: DateRange): Promise<number> {
  const row = await database.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(e.amountMinor) AS total FROM expenses e WHERE ${LIVE_IN_MONTH} AND ${SPEND}`,
    [range.from, range.to],
  );
  return row?.total ?? 0;
}

/** Spend per day across a month, oldest first; days with nothing spent are absent. */
export async function monthDailySpend(
  database: SqliteDatabase,
  range: DateRange,
): Promise<Array<{ date: string; totalMinor: number }>> {
  return database.getAllAsync<{ date: string; totalMinor: number }>(
    `SELECT e.date AS date, SUM(e.amountMinor) AS totalMinor
       FROM expenses e
      WHERE ${LIVE_IN_MONTH} AND ${SPEND}
      GROUP BY e.date
      ORDER BY e.date`,
    [range.from, range.to],
  );
}

/** A month's income, in minor units; 0 when there is none. */
export async function monthIncomeMinor(
  database: SqliteDatabase,
  range: DateRange,
): Promise<number> {
  const row = await database.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(e.amountMinor) AS total FROM expenses e
      WHERE ${LIVE_IN_MONTH} AND e.kind = 'income'`,
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

/** One category's spend in a month: the row the Summary's total, chart and legend share. */
export interface CategorySpend {
  /**
   * The category the spend is filed under, or null when neither the expense's own
   * category nor the fallback is a live row - see the note on the query below.
   */
  readonly categoryId: string | null;
  readonly name: string | null;
  readonly color: string | null;
  /**
   * The category's monthly limit, or null for none. Follows the same fold as the name: an
   * orphaned expense reports the fallback's budget, because that is the row it is filed under.
   */
  readonly monthlyBudgetMinor: number | null;
  /** Minor units, summed by SQLite as an integer. */
  readonly totalMinor: number;
  /** Live expenses in the group, including any whose amount is zero. */
  readonly expenseCount: number;
}

/**
 * A month's spend per category, largest first - the Summary's single read
 * (`docs/design/08-monthly-summary.md` §Behaviour rule 1).
 *
 * Rule 1's point is that the total, the chart, the legend and the count are "the same
 * data, aggregated once", so they cannot disagree. This is that aggregate, and the three
 * places it departs from the statement the spec prints are all in service of that:
 *
 * - **The join the legend needs is a `LEFT JOIN`, and an orphan is folded into the
 *   fallback category** rather than dropped. Rule 1's statement selects no name and no
 *   colour, so every legend has to join `categories`; joining *live* rows the way the rest
 *   of this client does would silently remove an expense whose category is tombstoned -
 *   a state an ordinary sync produces (`SYNC-43`) - and with it, its amount from this
 *   screen's total while Home kept it. The two tabs would then show different totals for
 *   the same month, which is `TVO-31` item 1 and the failure `05-month-switcher.md` rule 7
 *   exists to prevent. Folding is the answer the schema already states for a dangling
 *   `categoryId` ("renders as the fallback category", `migrations.ts`) and the one the
 *   expense list already renders (`listModel.ts`, `rowCategoryName`), so Summary agreeing
 *   with Home here also means it agrees with the rows Home draws.
 *
 *   The fold is in the `GROUP BY`, not after it: two groups mapping to one legend row is
 *   rule 1's stated cost, and merging them in SQL is what keeps `Uncategorized` from
 *   appearing twice.
 * - **`ORDER BY totalMinor DESC, name COLLATE NOCASE`.** The `default` state requires
 *   "ties broken by category name ascending so the order is stable between renders", and
 *   ties are ordinary - two categories with one `$20.00` expense each. Without the second
 *   key the order is a property of the query plan (`SUM-15`), so the legend reorders itself
 *   for reasons the user cannot see. `COLLATE NOCASE` because the column's own BINARY
 *   collation sorts every capital before every lowercase, which would file a user's `rent`
 *   after `Transport` (`SUM-16`, the same defect as `TVO-19` one query along).
 * - **A `null` group is still returned.** It means the expense's category is gone *and*
 *   there is no live `isDefault` row to fold into - a broken invariant only a buggy peer
 *   can produce. The amount is still money the user spent, so it is still counted and the
 *   screen names it with the contract's seed name rather than dropping it.
 */
export async function monthCategorySpend(
  database: SqliteDatabase,
  range: DateRange,
): Promise<readonly CategorySpend[]> {
  return await database.getAllAsync<CategorySpend>(
    `SELECT COALESCE(c.id, f.id)       AS categoryId,
            COALESCE(c.name, f.name)   AS name,
            COALESCE(c.color, f.color) AS color,
            -- CASE, not COALESCE: a live category with no budget must report null, not
            -- borrow the fallback's.
            CASE WHEN c.id IS NOT NULL THEN c.monthlyBudgetMinor
                 ELSE f.monthlyBudgetMinor END AS monthlyBudgetMinor,
            SUM(e.amountMinor)         AS totalMinor,
            COUNT(*)                   AS expenseCount
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
       -- The live fallback, as one row. ON 1 = 1 rather than a bare join so that a
       -- database with no fallback at all keeps its expenses: a cross join to an empty
       -- subquery returns nothing, and this screen's total would silently become zero.
       LEFT JOIN (
         SELECT id, name, color, monthlyBudgetMinor FROM categories
          WHERE isDefault = 1 AND deletedAt IS NULL
          ORDER BY id LIMIT 1
       ) f ON 1 = 1
      WHERE ${LIVE_IN_MONTH} AND ${SPEND}
      GROUP BY COALESCE(c.id, f.id)
      ORDER BY totalMinor DESC, name COLLATE NOCASE`,
    [range.from, range.to],
  );
}

/** One month's total, for the trend chart. */
export interface MonthlyTotal {
  readonly month: string;
  readonly totalMinor: number;
}

/**
 * Live spend per calendar month across `[fromMonth, toMonth]` (`YYYY-MM`, inclusive).
 *
 * Months with no expenses are simply absent; the caller fills the gaps, because "no row"
 * and "zero" are the same fact here and the chart needs every month in the window anyway.
 * Soft-deleted rows are excluded exactly as in {@link monthTotalMinor}, and the grouping
 * is on the raw `date` string like {@link monthsWithExpenses}.
 */
export async function monthlyTotals(
  database: SqliteDatabase,
  fromMonth: string,
  toMonth: string,
): Promise<readonly MonthlyTotal[]> {
  const rows = await database.getAllAsync<{ ym: string; total: number }>(
    `SELECT substr(e.date, 1, 7) AS ym, SUM(e.amountMinor) AS total
       FROM expenses e
      WHERE e.deletedAt IS NULL
        AND ${SPEND}
        AND substr(e.date, 1, 7) BETWEEN ? AND ?
      GROUP BY ym
      ORDER BY ym`,
    [fromMonth, toMonth],
  );
  return rows.map((row) => ({ month: row.ym, totalMinor: row.total }));
}

/** Live income per calendar month across `[fromMonth, toMonth]`; absent months are zero. */
export async function monthlyIncomeTotals(
  database: SqliteDatabase,
  fromMonth: string,
  toMonth: string,
): Promise<readonly MonthlyTotal[]> {
  const rows = await database.getAllAsync<{ ym: string; total: number }>(
    `SELECT substr(e.date, 1, 7) AS ym, SUM(e.amountMinor) AS total
       FROM expenses e
      WHERE e.deletedAt IS NULL
        AND e.kind = 'income'
        AND substr(e.date, 1, 7) BETWEEN ? AND ?
      GROUP BY ym
      ORDER BY ym`,
    [fromMonth, toMonth],
  );
  return rows.map((row) => ({ month: row.ym, totalMinor: row.total }));
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
  readonly kind: 'expense' | 'income';
  readonly amountMinor: number;
  readonly currency: string;
  readonly originalAmountMinor: number | null;
  readonly originalCurrency: string | null;
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
    `SELECT id, categoryId, kind, amountMinor, currency, originalAmountMinor, originalCurrency, date, note
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
      WHERE e.deletedAt IS NULL AND e.kind = 'expense'
      ORDER BY e.id DESC
      LIMIT 1`,
    [],
  );
  return row?.categoryId ?? null;
}

/** What a queued change did to its record, as the sync sheet labels it (§4). */
export type PendingOperation = 'added' | 'edited' | 'deleted';

/** One row of the sync sheet's `{n} changes waiting` list. */
export interface PendingChange {
  readonly entity: SyncEntity;
  readonly recordId: string;
  /** The expense's category name, or the category's own name. */
  readonly label: string;
  /** Minor units, or null for a category - a category has no amount to show. */
  readonly amountMinor: number | null;
  readonly operation: PendingOperation;
}

/**
 * The records with undrained outbox entries, oldest first
 * (`docs/design/02-offline-and-sync.md` §4, pending section).
 *
 * One row per *record*, not per entry, matching the count the pill shows (§3 rule 5):
 * three edits to one expense are one line reading `1 pending`, so they must be one line
 * here too.
 *
 * ### Where `Added` / `Edited` / `Deleted` comes from
 *
 * The outbox stores mutated fields, not an operation, so the label is derived from the
 * local row and the derivation is deliberate:
 *
 * - **`deletedAt` set → `Deleted`**, whatever else is queued for it. It is the outcome the
 *   user is waiting on. §4 rule 4 requires the category and amount to come from the
 *   tombstoned row rather than leaving a column of blanks, which is why the join does not
 *   filter on `deletedAt IS NULL`.
 * - **`revision = 0` → `Added`.** Revision is server-assigned, so zero means the server
 *   has never acknowledged this row: from the user's side the queued change *is* its
 *   creation.
 * - **anything else → `Edited`.**
 *
 * A pending category is listed with its name and no amount. The deck's item format has
 * three columns and assumes an expense; a category mutation has no amount to put in the
 * middle one, and omitting the record entirely would make this list disagree with the
 * header count above it.
 */
export async function listPendingChanges(
  database: SqliteDatabase,
): Promise<readonly PendingChange[]> {
  const rows = await database.getAllAsync<{
    entity: SyncEntity;
    recordId: string;
    amountMinor: number | null;
    expenseCategory: string | null;
    categoryName: string | null;
    deletedAt: string | null;
    revision: number | null;
  }>(
    `SELECT o.entity                            AS entity,
            o.recordId                          AS recordId,
            e.amountMinor                       AS amountMinor,
            ec.name                             AS expenseCategory,
            c.name                              AS categoryName,
            COALESCE(e.deletedAt, c.deletedAt)  AS deletedAt,
            COALESCE(e.revision, c.revision)    AS revision
       FROM outbox o
       LEFT JOIN expenses e ON o.entity = 'expense' AND e.id = o.recordId
       LEFT JOIN categories ec ON ec.id = e.categoryId
       LEFT JOIN categories c ON o.entity = 'category' AND c.id = o.recordId
      GROUP BY o.entity, o.recordId
      ORDER BY MIN(o.seq)`,
    [],
  );

  return rows.map((row) => ({
    entity: row.entity,
    recordId: row.recordId,
    // A row the outbox references but the store no longer holds cannot happen through any
    // write path in the app - both are written in one transaction - so the fallback is a
    // guard against a corrupted store rather than a state to design copy for.
    label: (row.entity === 'expense' ? row.expenseCategory : row.categoryName) ?? '',
    amountMinor: row.entity === 'expense' ? row.amountMinor : null,
    operation: row.deletedAt !== null ? 'deleted' : (row.revision ?? 0) === 0 ? 'added' : 'edited',
  }));
}

/** One live expense as the CSV export reads it. */
export interface ExportRow {
  readonly kind: 'expense' | 'income';
  readonly date: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly originalAmountMinor: number | null;
  readonly originalCurrency: string | null;
  readonly categoryName: string;
  readonly note: string | null;
}

/**
 * Every live expense, oldest first, with its category's name - for the CSV export.
 *
 * Oldest first, unlike every screen: a spreadsheet is read top to bottom and summed, and
 * a ledger reads forward in time. Ties on `date` break on `id`, which is UUIDv7 and so
 * orders by creation, which keeps two exports of the same data byte-identical.
 *
 * An expense whose category is gone is exported under the live fallback category's name
 * rather than dropped or left blank, for the reason `monthCategorySpend` gives: it is
 * still money the user spent. The `Uncategorized` literal is the contract's seed name,
 * used only when there is no live fallback row either - a broken invariant only a buggy
 * peer can produce - and never to *find* the fallback, which is resolved by its flag.
 *
 * Unbounded on purpose. An export that silently stops at a page size is a wrong file,
 * and the table is local and indexed on `(deletedAt, date, id)`.
 */
export async function listExpensesForExport(
  database: SqliteDatabase,
): Promise<readonly ExportRow[]> {
  return await database.getAllAsync<ExportRow>(
    `SELECT e.date,
            e.kind,
            e.amountMinor,
            e.currency,
            e.originalAmountMinor,
            e.originalCurrency,
            COALESCE(c.name, f.name, 'Uncategorized') AS categoryName,
            e.note
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
       LEFT JOIN (
         SELECT name FROM categories
          WHERE isDefault = 1 AND deletedAt IS NULL
          ORDER BY id LIMIT 1
       ) f ON 1 = 1
      WHERE e.deletedAt IS NULL
      ORDER BY e.date ASC, e.id ASC`,
    [],
  );
}

/** What the Home search bar asks for. Both parts are optional; both empty means "no search". */
export interface ExpenseSearch {
  /** Free text, matched against the note and the category name. Trimmed by the caller. */
  readonly text: string;
  /** Restrict to one category, or null for all of them. */
  readonly categoryId: string | null;
}

/** True when the search would narrow anything. Whitespace alone is not a search. */
export function isSearchActive(search: ExpenseSearch): boolean {
  return search.text.trim() !== '' || search.categoryId !== null;
}

/** Escape `%`, `_` and the escape character itself, so user text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function searchWhere(search: ExpenseSearch): { where: string; params: (string | number)[] } {
  const clauses = ['e.deletedAt IS NULL'];
  const params: (string | number)[] = [];
  const text = search.text.trim();
  if (text !== '') {
    const pattern = `%${escapeLike(text)}%`;
    clauses.push(
      `(e.note LIKE ? ESCAPE '\\' OR COALESCE(c.name, (SELECT f.name FROM categories f WHERE f.isDefault = 1 AND f.deletedAt IS NULL ORDER BY f.id LIMIT 1), '') LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern);
  }
  if (search.categoryId !== null) {
    clauses.push('e.categoryId = ?');
    params.push(search.categoryId);
  }
  return { where: clauses.join(' AND '), params };
}

/**
 * Expenses matching a search, across every month, newest first.
 *
 * Search deliberately ignores the selected month: someone looking for "dentist" does not know
 * which month it was in. Local SQLite only, so it works offline like everything else.
 */
export async function searchExpenses(
  database: SqliteDatabase,
  search: ExpenseSearch,
  page: { readonly limit: number; readonly offset?: number } = { limit: 100 },
): Promise<readonly ExpenseListItem[]> {
  const { where, params } = searchWhere(search);
  return selectExpenseItems(database, where, params, page);
}

/** Count and total of everything a search matches, computed over all matches, not one page. */
export async function searchSummary(
  database: SqliteDatabase,
  search: ExpenseSearch,
): Promise<{ readonly count: number; readonly totalMinor: number }> {
  const { where, params } = searchWhere(search);
  const row = await database.getFirstAsync<{ count: number; total: number | null }>(
    `SELECT COUNT(*) AS count,
            SUM(CASE WHEN e.kind = 'expense' THEN e.amountMinor ELSE 0 END) AS total
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
      WHERE ${where}`,
    params,
  );
  return { count: row?.count ?? 0, totalMinor: row?.total ?? 0 };
}

/** A recurring rule as the list consumes it: the row, its category, its local sync state. */
export interface RecurringListItem {
  readonly id: string;
  readonly categoryId: string;
  /** The live category's name, or null when it is gone - the rule files under the fallback. */
  readonly categoryName: string | null;
  readonly categoryColor: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  readonly frequency: 'weekly' | 'monthly';
  readonly startDate: string;
  readonly endDate: string | null;
  readonly pending: boolean;
}

/**
 * Every live rule, soonest-started first, with its category resolved.
 *
 * A `LEFT JOIN` on live categories: a rule whose category was deleted stays in the list
 * (it is still generating, under the fallback) rather than vanishing from the one screen
 * that can delete it.
 */
export async function listLiveRecurring(
  database: SqliteDatabase,
): Promise<readonly RecurringListItem[]> {
  const rows = await database.getAllAsync<Omit<RecurringListItem, 'pending'> & { pending: number }>(
    `SELECT r.id, r.categoryId, c.name AS categoryName, c.color AS categoryColor,
            r.amountMinor, r.currency, r.note, r.frequency, r.startDate, r.endDate,
            EXISTS (
              SELECT 1 FROM outbox o WHERE o.entity = 'recurring' AND o.recordId = r.id
            ) AS pending
       FROM recurring r
       LEFT JOIN categories c ON c.id = r.categoryId AND c.deletedAt IS NULL
      WHERE r.deletedAt IS NULL
      ORDER BY r.startDate, r.id`,
    [],
  );
  return rows.map((row) => ({ ...row, pending: row.pending === 1 }));
}

/** A savings goal as the list consumes it: the row plus its local sync state. */
export interface GoalListItem {
  readonly id: string;
  readonly name: string;
  readonly targetMinor: number;
  readonly savedMinor: number;
  readonly currency: string;
  readonly deadline: string | null;
  readonly pending: boolean;
}

/** Every live goal, soonest deadline first (no deadline last), then by name. */
export async function listLiveGoals(database: SqliteDatabase): Promise<readonly GoalListItem[]> {
  const rows = await database.getAllAsync<Omit<GoalListItem, 'pending'> & { pending: number }>(
    `SELECT g.id, g.name, g.targetMinor, g.savedMinor, g.currency, g.deadline,
            EXISTS (
              SELECT 1 FROM outbox o WHERE o.entity = 'goal' AND o.recordId = g.id
            ) AS pending
       FROM goals g
      WHERE g.deletedAt IS NULL
      ORDER BY g.deadline IS NULL, g.deadline, g.name COLLATE NOCASE, g.id`,
    [],
  );
  return rows.map((row) => ({ ...row, pending: row.pending === 1 }));
}
