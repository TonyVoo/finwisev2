import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBar, Fab, IconButton } from '@/components/Chrome';
import { useSnackbar } from '@/components/Snackbar';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useLocalWrite } from '@/db/localWrite';
import { clearCategoryReviewPending } from '@/db/onboarding';
import { queryKeys } from '@/query/keys';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAnyExpensesExist,
  useCategoryReviewPending,
  useMonthCategorySpend,
  useExpenseSearch,
  useExpenseSearchSummary,
  useLiveCategories,
  useMonthExpenses,
  useMonthDailySpend,
  useMonthIncome,
  useMonthTotal,
  useUserCurrency,
} from '@/db/hooks';
import { isSearchActive } from '@/db/queries';
import { deleteExpense, restoreExpense } from '@/db/mutations';
import { BudgetAlertBanner } from '@/expenses/BudgetAlertBanner';
import { CategoryReviewBanner } from '@/expenses/CategoryReviewBanner';
import { budgetAlert } from '@/summary/budgetAlerts';
import { notifyBudgetAlert } from '@/notifications/budgetNotifier';
import { summariseMonth } from '@/summary/summaryModel';
import { ExpenseRow } from '@/expenses/ExpenseRow';
import { groupByDate } from '@/expenses/listModel';
import { FirstRunEmpty, ListSkeleton, MonthEmpty, SearchEmpty } from '@/expenses/ListStates';
import { MonthTotal } from '@/expenses/MonthTotal';
import { SearchBar } from '@/expenses/SearchBar';
import { formatMoney } from '@/lib/money';
import { useFirstPaintSkeleton } from '@/expenses/useFirstPaint';
import { useAwaitingFirstSync } from '@/sync/useAwaitingFirstSync';
import { daysInMonth as daysIn, monthLabel } from '@/lib/calendar';
import { cumulativeSeries } from '@/expenses/spendPace';
import { MonthSwitcher } from '@/month/MonthSwitcher';
import { SyncIndicator } from '@/sync/SyncIndicator';
import { usePullToRefresh } from '@/sync/usePullToRefresh';
import { useSelectedMonth } from '@/month/MonthProvider';
import { size, space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Home - the expense list. `docs/design/04-expense-list.md`.
 *
 * Everything on this screen comes from local SQLite and nothing on it waits for a network.
 * There is no error state to design for and no read spinner beyond the first-paint
 * skeleton, because a local read cannot fail on connectivity (`02-offline-and-sync.md`
 * §1). The whole screen works identically in airplane mode, which is the product's main
 * promise rather than a feature of it.
 *
 * ### Delete, and why there is no confirmation
 *
 * A swipe commits a **soft** delete immediately and raises the `Expense deleted.` snackbar
 * with `Undo`. The snackbar *is* the confirmation (rule 7) - a dialog as well would be
 * asking twice. Three consequences the implementation has to get right rather than
 * approximate:
 *
 * - **The delete is committed to SQLite before the snackbar appears**, so if the app is
 *   killed while the snackbar is up, the delete stands (rule 9). Nothing is held in memory
 *   waiting to be flushed, which is also why Undo cannot "cancel" anything - it writes a
 *   second mutation.
 * - **Undo is an ordinary update**, clearing `deletedAt`, so it stays available even after
 *   the delete has already reached the server. There is no race to lose.
 * - **A second delete replaces the first snackbar and the first delete stands** (rule 9).
 *   That falls out of the snackbar being a single app-level slot rather than per-row state.
 */

export const HOME_LIST_TEST_ID = 'home-list';

/** The FAB's height plus the two `space.4` gaps the spec puts around it (§Elements). */
const FAB_CLEARANCE = size.fab + space[4] + space[4];

export default function ExpenseListScreen() {
  const styles = useStyles();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const insets = useSafeAreaInsets();
  const { month, currentMonth, today, isCurrent, goToCurrent } = useSelectedMonth();

  const [scrolled, setScrolled] = useState(false);

  // Search is local screen state: closing the bar discards it, and nothing about it is worth
  // restoring after a restart.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchCategory, setSearchCategory] = useState<string | null>(null);
  const [debouncedText, setDebouncedText] = useState('');
  useEffect(() => {
    // Clearing is immediate; typing waits 200ms so a query is not run per keystroke.
    if (searchText === '') {
      setDebouncedText('');
      return undefined;
    }
    const handle = setTimeout(() => setDebouncedText(searchText), 200);
    return () => clearTimeout(handle);
  }, [searchText]);
  const search = { text: debouncedText, categoryId: searchCategory };
  const searching = searchOpen && isSearchActive(search);
  const searchRows = useExpenseSearch(searching ? search : { text: '', categoryId: null });
  const searchSummary = useExpenseSearchSummary(
    searching ? search : { text: '', categoryId: null },
  );
  const categories = useLiveCategories();

  const database = useDatabase();
  const queryClient = useQueryClient();
  const reviewPending = useCategoryReviewPending();

  // Budgets are a this-month question: telling someone in October that they overspent in
  // March is history, not a warning. Dismissal is remembered by what was dismissed, so a
  // second category going over brings the banner back.
  const monthSpend = useMonthCategorySpend(month);
  const [dismissedAlert, setDismissedAlert] = useState<string | null>(null);
  const alert = isCurrent ? budgetAlert(summariseMonth(monthSpend.data ?? []).entries) : null;
  const alertKey = alert?.key ?? null;
  useEffect(() => {
    if (alert === null) return;
    void notifyBudgetAlert(database, month, alert).catch(() => undefined);
    // Keyed on the alert's own key: its object identity changes on every render.
  }, [database, month, alertKey]);
  // Both answers clear it, so it is asked once. Not a `localWrite`: this is a fact about the
  // device, not a record, so there is nothing to sync.
  const answerCategoryReview = useCallback(
    async (open: boolean) => {
      await clearCategoryReviewPending(database);
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.categoryReview() });
      if (open) router.push('/(app)/settings/categories');
    },
    [database, queryClient, router],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchText('');
    setDebouncedText('');
    setSearchCategory(null);
  }, []);
  const pullToRefresh = usePullToRefresh();

  const expenses = useMonthExpenses(month);
  const total = useMonthTotal(month);
  const income = useMonthIncome(month);
  const daily = useMonthDailySpend(month);
  const monthDays = daysIn(month);
  // The current month stops at today, so the bars do not flat-line into the future.
  const shownDays = isCurrent ? Number(today.slice(8, 10)) : monthDays;
  const series = daily.data === undefined ? undefined : cumulativeSeries(daily.data, month, shownDays);
  const anyExist = useAnyExpensesExist();
  const currency = useUserCurrency();

  // The skeleton covers the frame or two before the first read returns, and is abandoned
  // after 300ms whatever happens - see `useFirstPaintSkeleton`.
  // Longer than that while no sync has ever completed and nothing is held locally: an empty
  // store there is "not loaded yet", not "no expenses" (`useAwaitingFirstSync`).
  const awaitingFirstSync = useAwaitingFirstSync();
  const showSkeleton =
    useFirstPaintSkeleton(
      expenses.isPending || total.isPending || anyExist.isPending || currency.isPending,
    ) || awaitingFirstSync;

  const rows = searching ? (searchRows.data ?? []) : (expenses.data ?? []);
  const sections = groupByDate(rows, today);

  // `undefined` while the read is in flight, `null` when there is no user row. Neither is
  // a currency, and formatting an amount without one would put a dollar sign in front of
  // a euro figure - so both hold the total on its skeleton (`db/hooks.ts`).
  const currencyCode = currency.data ?? null;

  const onDelete = useCallback(
    async (id: string) => {
      // Committed first, announced second. The order is the rule: the snackbar reports
      // something that has already happened.
      await localWrite((database) => deleteExpense(database, id));
      AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.deleted);

      showSnackbar({
        message: SNACK_COPY.expense.deleted,
        action: {
          label: COPY.common.undo,
          onPress: () => {
            void localWrite((database) => restoreExpense(database, id)).then(() => {
              AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.restored);
            });
          },
        },
      });
    },
    [localWrite, showSnackbar],
  );

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.home.title}
        // `elevation.1` only once the list has scrolled past 0 (element 1).
        elevated={scrolled}
        trailing={
          <>
            {/* The pill leads the gear, as `02-offline-and-sync.md` §3 draws it: trailing
                in the bar, and in a fixed-width slot so the title never shifts when sync
                state changes. */}
            <IconButton
              icon={searchOpen ? 'x' : 'search'}
              label={searchOpen ? COPY.home.search.close : COPY.home.search.open}
              onPress={searchOpen ? closeSearch : () => setSearchOpen(true)}
              testID="home-search"
            />
            <SyncIndicator />
            <IconButton
              icon="settings"
              label={COPY.settings.title}
              onPress={() => router.push('/(app)/settings')}
              testID="home-settings"
            />
          </>
        }
      />

      {searchOpen ? (
        <SearchBar
          text={searchText}
          onChangeText={setSearchText}
          categoryId={searchCategory}
          onChangeCategory={setSearchCategory}
          categories={categories.data ?? []}
        />
      ) : (
        <MonthSwitcher onOpenPicker={() => router.push('/(app)/month-picker')} />
      )}

      {alert !== null && alert.key !== dismissedAlert && !searchOpen ? (
        <BudgetAlertBanner
          alert={alert}
          onOpen={() => router.navigate('/(app)/(tabs)/summary')}
          onDismiss={() => setDismissedAlert(alert.key)}
        />
      ) : null}

      {reviewPending.data === true && !searchOpen ? (
        <CategoryReviewBanner
          onReview={() => void answerCategoryReview(true)}
          onDismiss={() => void answerCategoryReview(false)}
        />
      ) : null}

      {searching ? (
        // Across every month, so the month total would be the wrong number to show. This is
        // the aggregate over all matches, not over the rendered page (rule 3 again).
        <Text testID="search-summary" style={styles.searchSummary} accessibilityLiveRegion="polite">
          {searchSummary.data === undefined || currencyCode === null
            ? ' '
            : `${
                searchSummary.data.count === 1
                  ? COPY.home.search.resultsOne
                  : COPY.home.search.resultsMany.replace(
                      '{count}',
                      String(searchSummary.data.count),
                    )
              } · ${formatMoney(searchSummary.data.totalMinor, currencyCode)}`}
        </Text>
      ) : searchOpen ? null : (
        // The total renders above the list and outside it, so it stays put while the rows
        // scroll - and so a paginated list can never be mistaken for its source (rule 3).
        <MonthTotal
          totalMinor={currencyCode === null || awaitingFirstSync ? undefined : total.data}
          currency={currencyCode ?? ''}
          isCurrentMonth={isCurrent}
          incomeMinor={currencyCode === null || awaitingFirstSync ? undefined : income.data}
          series={series}
          daysInMonth={monthDays}
        />
      )}

      <SectionList
        testID={HOME_LIST_TEST_ID}
        sections={showSkeleton ? [] : sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 0)}
        scrollEventThrottle={16}
        // A sync, not a reload: the rows are already current (rule 12). The spinner is
        // tied to the sync attempt and stops immediately when there is no network, where
        // the pill - not this list - carries the explanation.
        //
        // `listProps` because this is a `SectionList`, which reads `refreshing`/`onRefresh`
        // and builds its own control. Summary is a `ScrollView` and takes the built
        // control instead - see `usePullToRefresh`.
        {...pullToRefresh.listProps}
        // Deep enough that the last row can always be scrolled clear of the FAB
        // (§Elements, FAB position).
        contentContainerStyle={{ paddingBottom: FAB_CLEARANCE + insets.bottom }}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <ExpenseRow
            item={item}
            today={today}
            lastInGroup={index === section.data.length - 1}
            onPress={() => router.push(`/(app)/expense/${item.id}`)}
            onDelete={() => void onDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          showSkeleton ? (
            <ListSkeleton />
          ) : searching ? (
            <SearchEmpty />
          ) : anyExist.data === true ? (
            // Expenses exist, just not here: offer navigation, not a tutorial.
            <MonthEmpty
              monthName={monthLabel(month)}
              currentMonthName={monthLabel(currentMonth)}
              isCurrentMonth={isCurrent}
              onGoToCurrentMonth={goToCurrent}
            />
          ) : (
            <FirstRunEmpty onAddFirst={() => router.push('/(app)/expense/new')} />
          )
        }
      />

      {/* Always enabled: there is no state in this app where adding an expense is
          unavailable (rule 10). Last in the focus order, after the list, so a
          screen-reader user is not forced past it to reach their expenses. */}
      <Fab
        label={COPY.home.fab}
        onPress={() => router.push('/(app)/expense/new')}
        testID="home-fab"
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: color.bg.canvas,
    },
    searchSummary: {
      ...type.footnote,
      color: color.text.secondary,
      paddingHorizontal: space[4],
      paddingBottom: space[2],
    },
    sectionHeader: {
      ...type.caption,
      color: color.text.tertiary,
      backgroundColor: color.bg.canvas,
      paddingHorizontal: space[4],
      paddingVertical: space[2],
    },
  }),
);
