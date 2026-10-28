import { useTabBarReserve } from '@/navigation/tabBar';
import { useDeleteExpense } from '@/expenses/useDeleteExpense';
import { useAddedBy } from '@/household/useAddedBy';
import { useCallback, useEffect, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBar, Fab, IconButton } from '@/components/Chrome';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { clearCategoryReviewPending } from '@/db/onboarding';
import { queryKeys } from '@/query/keys';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAnyExpensesExist,
  useCategoryReviewPending,
  useMonthCategorySpend,
  useMonthExpenses,
  useMonthDailySpend,
  useMonthPrivateSpend,
  useMonthIncome,
  useMonthTotal,
  useUserCurrency,
} from '@/db/hooks';
import { BudgetAlertBanner } from '@/expenses/BudgetAlertBanner';
import { CategoryReviewBanner } from '@/expenses/CategoryReviewBanner';
import { budgetAlert } from '@/summary/budgetAlerts';
import { notifyBudgetAlert } from '@/notifications/budgetNotifier';
import { summariseMonth } from '@/summary/summaryModel';
import { ExpenseRow } from '@/expenses/ExpenseRow';
import { groupByDate } from '@/expenses/listModel';
import { FirstRunEmpty, ListSkeleton, MonthEmpty } from '@/expenses/ListStates';
import { MonthTotal } from '@/expenses/MonthTotal';
import { useFirstPaintSkeleton } from '@/expenses/useFirstPaint';
import { useAwaitingFirstSync } from '@/sync/useAwaitingFirstSync';
import { daysInMonth as daysIn, monthLabel } from '@/lib/calendar';
import { cumulativeSeries, projectedMonthEnd } from '@/expenses/spendPace';
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
  const insets = useSafeAreaInsets();
  const tabBarReserve = useTabBarReserve();
  const { month, currentMonth, today, isCurrent, goToCurrent } = useSelectedMonth();

  const [scrolled, setScrolled] = useState(false);

  const database = useDatabase();
  const addedBy = useAddedBy();
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

  const pullToRefresh = usePullToRefresh();

  const expenses = useMonthExpenses(month);
  const total = useMonthTotal(month);
  const income = useMonthIncome(month);
  const daily = useMonthDailySpend(month);
  const privateSpend = useMonthPrivateSpend(month);
  const monthDays = daysIn(month);
  // The current month stops at today, so the bars do not flat-line into the future.
  const shownDays = isCurrent ? Number(today.slice(8, 10)) : monthDays;
  const series =
    daily.data === undefined ? undefined : cumulativeSeries(daily.data, month, shownDays);
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

  const sections = groupByDate(expenses.data ?? [], today);

  // `undefined` while the read is in flight, `null` when there is no user row. Neither is
  // a currency, and formatting an amount without one would put a dollar sign in front of
  // a euro figure - so both hold the total on its skeleton (`db/hooks.ts`).
  const currencyCode = currency.data ?? null;

  const onDelete = useDeleteExpense();

  return (
    <View style={styles.screen}>
      <AppBar
        large
        title={COPY.home.title}
        // `elevation.1` only once the list has scrolled past 0 (element 1).
        elevated={scrolled}
        trailing={
          <>
            {/* The sync pill leads the search button, trailing in the bar in a fixed-width slot so
                the title never shifts when sync state changes (`02-offline-and-sync.md` §3). */}
            <SyncIndicator />
            <IconButton
              icon="search"
              label={COPY.home.search.open}
              onPress={() => router.push('/(app)/search')}
              testID="home-search"
            />
          </>
        }
      />

      <MonthSwitcher onOpenPicker={() => router.push('/(app)/month-picker')} />

      {alert !== null && alert.key !== dismissedAlert ? (
        <BudgetAlertBanner
          alert={alert}
          onOpen={() => router.navigate('/(app)/(tabs)/summary')}
          onDismiss={() => setDismissedAlert(alert.key)}
        />
      ) : null}

      {reviewPending.data === true ? (
        <CategoryReviewBanner
          onReview={() => void answerCategoryReview(true)}
          onDismiss={() => void answerCategoryReview(false)}
        />
      ) : null}

      {/* The total renders above the list and outside it, so it stays put while the rows
          scroll - and so a paginated list can never be mistaken for its source (rule 3). */}
      <MonthTotal
        totalMinor={currencyCode === null || awaitingFirstSync ? undefined : total.data}
        currency={currencyCode ?? ''}
        isCurrentMonth={isCurrent}
        incomeMinor={currencyCode === null || awaitingFirstSync ? undefined : income.data}
        series={series}
        privateMinor={currencyCode === null || awaitingFirstSync ? undefined : privateSpend.data}
        paceMinor={
          isCurrent && total.data !== undefined && shownDays < monthDays
            ? projectedMonthEnd(total.data, shownDays, monthDays)
            : null
        }
        daysInMonth={monthDays}
      />

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
        // The floating tab bar covers the bottom of the screen, so the last row has to clear it
        // as well as the add button.
        contentContainerStyle={{ paddingBottom: FAB_CLEARANCE + insets.bottom + tabBarReserve }}
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
            addedBy={addedBy(item.createdBy)}
            onPress={() => router.push(`/(app)/expense/${item.id}`)}
            onDelete={() => void onDelete(item.id)}
          />
        )}
        ListEmptyComponent={
          showSkeleton ? (
            <ListSkeleton />
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
        // Above the floating bar, which is over the screen rather than under it.
        bottomOffset={tabBarReserve}
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
