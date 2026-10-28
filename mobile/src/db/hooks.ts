import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { LIMITS } from '@expense-tracker/shared';
import { queryKeys } from '../query/keys';
import { type MonthKey, monthRange, stepMonth } from '../lib/calendar';
import { TREND_MONTHS } from '../summary/trendModel';
import { useDatabase } from './DatabaseProvider';
import { readCategoryRenameAnswered, readCategoryReviewPending } from './onboarding';
import { readEmailVerified, readUserCurrency, readUserDisplayName, readUserEmail } from './user';
import {
  type CategoryListItem,
  type CategorySpend,
  type CategoryWithCount,
  type ExpenseDetail,
  type ExpenseListItem,
  type ExpenseSearch,
  type PendingChange,
  type GoalListItem,
  type RecurringListItem,
  anyExpensesExist,
  coloursInUse,
  countPendingRecords,
  findExpense,
  findFallbackCategory,
  isSearchActive,
  lastUsedCategoryId,
  listLiveCategories,
  listLiveCategoriesWithCounts,
  listMonthExpenses,
  listLiveRecurring,
  listPendingChanges,
  monthCategorySpend,
  monthDailySpend,
  monthPrivateSpendMinor,
  monthTotalMinor,
  monthlyTotals,
  type MonthlyTotal,
  monthsWithExpenses,
  searchExpenses,
  monthIncomeMinor,
  monthlyIncomeTotals,
  listLiveGoals,
  searchSummary,
} from './queries';

/**
 * The shape every read in this app takes: a SQLite query behind a TanStack Query key.
 *
 * Note what is missing from the call sites. No `isError` branch, because a local read
 * has no network to fail on. No `isLoading` spinner in the screens either - the query
 * resolves within a frame or two, and `docs/design/02-offline-and-sync.md` §1 forbids a
 * read spinner outright.
 *
 * The first two prove the pattern; the rest, below, are what the expense and category
 * screens read.
 */

export function useLiveCategories(): UseQueryResult<readonly CategoryListItem[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.categories.live(),
    queryFn: () => listLiveCategories(database),
  });
}

/** Count behind the sync pill (`docs/design/02-offline-and-sync.md` §3). */
export function usePendingRecordCount(): UseQueryResult<number> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.outbox.pendingCount(),
    queryFn: () => countPendingRecords(database),
  });
}

/**
 * The queued changes the sync sheet lists (§4, pending section).
 *
 * Its own key rather than a selector over the count: the sheet is the only thing that
 * reads it, and it is the only read in the app that deliberately includes tombstoned rows
 * (§4 rule 4 - a `Deleted` line still shows what was deleted).
 */
export function usePendingChanges(): UseQueryResult<readonly PendingChange[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.outbox.pendingChanges(),
    queryFn: () => listPendingChanges(database),
  });
}

/**
 * The reads the expense and category screens run on.
 *
 * Each is one SQLite query behind one key. Two conventions hold throughout and both come
 * from the architecture rather than from taste:
 *
 * - **A month-scoped read takes the `MonthKey` and derives its own bounds.** The bounds
 *   are the inclusive `YYYY-MM-DD` pair from `monthRange`, compared as text, so no
 *   expense can change month because of where the device is
 *   (`docs/design/05-month-switcher.md` rule 11).
 * - **There is no `isError` branch at any call site.** A local read fails only if the SQL
 *   is wrong, which is a crash and not a screen state (`02-offline-and-sync.md` §1).
 */

/** One page of the selected month, newest day first (`04-expense-list.md` state `default`). */
export function useMonthExpenses(
  month: MonthKey,
  page: { readonly limit: number; readonly offset?: number } = {
    limit: LIMITS.EXPENSE_LIST_DEFAULT_LIMIT,
  },
): UseQueryResult<readonly ExpenseListItem[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.month(month),
    queryFn: () => listMonthExpenses(database, monthRange(month), page),
  });
}

/**
 * The selected month's total, in minor units.
 *
 * Its own key and its own query, never a reduction over whatever `useMonthExpenses`
 * returned: the page is windowed, so a sum over it would be wrong the moment a month
 * exceeds one page (`04-expense-list.md` rule 3).
 */
export function useMonthTotal(month: MonthKey): UseQueryResult<number> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.monthTotal(month),
    queryFn: () => monthTotalMinor(database, monthRange(month)),
  });
}

/** What this month's private expenses add up to, for the line under the total. */
export function useMonthPrivateSpend(month: MonthKey): UseQueryResult<number> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.monthPrivate(month),
    queryFn: () => monthPrivateSpendMinor(database, monthRange(month)),
  });
}

/** The selected month's spend per day: the Home sparkline's data. */
export function useMonthDailySpend(
  month: MonthKey,
): UseQueryResult<Array<{ date: string; totalMinor: number }>> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.monthDailySpend(month),
    queryFn: () => monthDailySpend(database, monthRange(month)),
  });
}

/** The selected month's income, in minor units. */
export function useMonthIncome(month: MonthKey): UseQueryResult<number> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.monthIncome(month),
    queryFn: () => monthIncomeMinor(database, monthRange(month)),
  });
}

/**
 * The selected month's spend per category, largest first - the Summary's one read.
 *
 * Everything on that screen is derived from these rows: the total is their sum, the count
 * is the sum of their counts, and the chart is a picture of the legend they produce
 * (`docs/design/08-monthly-summary.md` §Behaviour rule 1). Reading the total from
 * {@link useMonthTotal} instead would be a second aggregate over the same table, and the
 * two could then disagree on screen with nothing to say which was right.
 */
export function useMonthCategorySpend(month: MonthKey): UseQueryResult<readonly CategorySpend[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.monthByCategory(month),
    queryFn: () => monthCategorySpend(database, monthRange(month)),
  });
}

/** Per-month spend for the trend chart: the {@link TREND_MONTHS} months ending at `month`. */
export function useSpendTrend(month: MonthKey): UseQueryResult<readonly MonthlyTotal[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.trend(month),
    queryFn: () => monthlyTotals(database, stepMonth(month, -(TREND_MONTHS - 1)), month),
  });
}

/** Per-month income for the trend chart, over the same window as {@link useSpendTrend}. */
export function useIncomeTrend(month: MonthKey): UseQueryResult<readonly MonthlyTotal[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.incomeTrend(month),
    queryFn: () => monthlyIncomeTotals(database, stepMonth(month, -(TREND_MONTHS - 1)), month),
  });
}

/**
 * Whether any expense exists in any month.
 *
 * What separates Home's two empty states: "first run" teaches a new user what the app is
 * for, and "nothing in this month" offers navigation to one who already knows. It cannot
 * be derived from the month's total, because a month of zero-amount expenses totals `0`
 * and is not empty.
 */
export function useAnyExpensesExist(): UseQueryResult<boolean> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.anyExist(),
    queryFn: () => anyExpensesExist(database),
  });
}

/** Months holding at least one live expense - the picker grid's dots (rule 9). */
export function useMonthsWithExpenses(): UseQueryResult<readonly string[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.months(),
    queryFn: () => monthsWithExpenses(database),
  });
}

/**
 * One expense by id, for the form in edit mode.
 *
 * `null` is a real answer rather than an absence: a tombstoned row and a missing row both
 * resolve to it, and both land on `Expense not found` - the row the user was offered to
 * edit is gone either way (`06-expense-form.md` state `error` (b)).
 *
 * Pass `null` in add mode, which disables the query rather than reading for an id that
 * does not exist. The form would ignore the result either way, so running it would be a
 * SQLite round trip and a cache entry per Add, keyed on the empty string.
 */
export function useExpense(id: string | null): UseQueryResult<ExpenseDetail | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.expenses.detail(id ?? ''),
    queryFn: () => findExpense(database, id ?? ''),
    enabled: id !== null,
  });
}

/** The recurring-expense list. */
export function useRecurringList(): UseQueryResult<readonly RecurringListItem[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.recurring.live(),
    queryFn: () => listLiveRecurring(database),
  });
}

/** The savings-goal list. */
export function useGoalsList(): UseQueryResult<readonly GoalListItem[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.goals.live(),
    queryFn: () => listLiveGoals(database),
  });
}

/** The category list's rows: every live category with its all-time expense count. */
export function useCategoriesWithCounts(): UseQueryResult<readonly CategoryWithCount[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.categories.withCounts(),
    queryFn: () => listLiveCategoriesWithCounts(database),
  });
}

/**
 * The live `isDefault` category.
 *
 * Resolved by the flag and never by matching the name `Uncategorized`: renaming it is
 * permitted, so the row may be called anything (`07-categories.md` §3 rule 2). `null`
 * means the invariant is broken, which only a buggy peer can do; the repair lives in the
 * delete path, not here.
 */
export function useFallbackCategory(): UseQueryResult<CategoryListItem | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.categories.fallback(),
    queryFn: () => findFallbackCategory(database),
  });
}

/** The category to preselect in add mode, or null on the very first expense (rule 1). */
export function useLastUsedCategoryId(): UseQueryResult<string | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.categories.lastUsed(),
    queryFn: () => lastUsedCategoryId(database),
  });
}

/**
 * The currency every amount is formatted in, chosen once at signup.
 *
 * `undefined` while the read is in flight and `null` when there is no user row. Both mean
 * "do not format an amount yet": a screen that defaulted to `USD` would render a dollar
 * sign in front of a euro figure for a frame, which is worse than rendering the skeleton
 * it already has for this case.
 */
export function useUserCurrency(): UseQueryResult<string | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.user.currency(),
    queryFn: () => readUserCurrency(database),
  });
}

/** The signed-in account's email, for the read-only Settings row. */
/** The account's own display name, for Settings. */
export function useUserDisplayName(): UseQueryResult<string | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.user.displayName(),
    queryFn: () => readUserDisplayName(database),
  });
}

export function useUserEmail(): UseQueryResult<string | null> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.user.email(),
    queryFn: () => readUserEmail(database),
  });
}

/** Whether the account's email is verified, for Settings' Verify email row. */
export function useEmailVerified(): UseQueryResult<boolean> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.user.emailVerified(),
    queryFn: () => readEmailVerified(database),
  });
}

/** Colours a live category already wears, for the picker's `In use` labels (§2 rule 5). */
export function useColoursInUse(): UseQueryResult<readonly string[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.categories.coloursInUse(),
    queryFn: () => coloursInUse(database),
  });
}

/** Matches for the Home search, across every month. Keyed on the trimmed text. */
export function useExpenseSearch(
  search: ExpenseSearch,
): UseQueryResult<readonly ExpenseListItem[]> {
  const database = useDatabase();
  const text = search.text.trim();
  return useQuery({
    queryKey: queryKeys.expenses.search(text, search.categoryId, search.privateOnly === true),
    queryFn: () =>
      searchExpenses(database, {
        text,
        categoryId: search.categoryId,
        privateOnly: search.privateOnly,
      }),
    enabled: isSearchActive(search),
  });
}

/** Count and total of everything the search matches (not just the rendered page). */
export function useExpenseSearchSummary(
  search: ExpenseSearch,
): UseQueryResult<{ readonly count: number; readonly totalMinor: number }> {
  const database = useDatabase();
  const text = search.text.trim();
  return useQuery({
    queryKey: [
      ...queryKeys.expenses.search(text, search.categoryId, search.privateOnly === true),
      'summary',
    ] as const,
    queryFn: () =>
      searchSummary(database, {
        text,
        categoryId: search.categoryId,
        privateOnly: search.privateOnly,
      }),
    enabled: isSearchActive(search),
  });
}

/** Whether Home should still offer the one-time "review your categories" prompt. */
export function useCategoryRenameAnswered(): UseQueryResult<boolean> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.onboarding.categoryRename(),
    queryFn: () => readCategoryRenameAnswered(database),
  });
}

export function useCategoryReviewPending(): UseQueryResult<boolean> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.onboarding.categoryReview(),
    queryFn: () => readCategoryReviewPending(database),
  });
}
