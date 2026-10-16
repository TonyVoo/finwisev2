import { useCallback, useState } from 'react';
import { AccessibilityInfo, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBar, Fab, IconButton } from '@/components/Chrome';
import { useSnackbar } from '@/components/Snackbar';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { useLocalWrite } from '@/db/localWrite';
import { useAnyExpensesExist, useMonthExpenses, useMonthTotal, useUserCurrency } from '@/db/hooks';
import { deleteExpense, restoreExpense } from '@/db/mutations';
import { ExpenseRow } from '@/expenses/ExpenseRow';
import { groupByDate } from '@/expenses/listModel';
import { FirstRunEmpty, ListSkeleton, MonthEmpty } from '@/expenses/ListStates';
import { MonthTotal } from '@/expenses/MonthTotal';
import { useFirstPaintSkeleton } from '@/expenses/useFirstPaint';
import { monthLabel } from '@/lib/calendar';
import { MonthSwitcher } from '@/month/MonthSwitcher';
import { SyncIndicator } from '@/sync/SyncIndicator';
import { usePullToRefresh } from '@/sync/usePullToRefresh';
import { useSelectedMonth } from '@/month/MonthProvider';
import { color, size, space, type } from '@/theme/tokens';

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
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const insets = useSafeAreaInsets();
  const { month, currentMonth, today, isCurrent, goToCurrent } = useSelectedMonth();

  const [scrolled, setScrolled] = useState(false);
  const pullToRefresh = usePullToRefresh();

  const expenses = useMonthExpenses(month);
  const total = useMonthTotal(month);
  const anyExist = useAnyExpensesExist();
  const currency = useUserCurrency();

  // The skeleton covers the frame or two before the first read returns, and is abandoned
  // after 300ms whatever happens - see `useFirstPaintSkeleton`.
  const showSkeleton = useFirstPaintSkeleton(
    expenses.isPending || total.isPending || anyExist.isPending || currency.isPending,
  );

  const rows = expenses.data ?? [];
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

      <MonthSwitcher onOpenPicker={() => router.push('/(app)/month-picker')} />

      {/* The total renders above the list and outside it, so it stays put while the rows
          scroll - and so a paginated list can never be mistaken for its source (rule 3). */}
      <MonthTotal
        totalMinor={currencyCode === null ? undefined : total.data}
        currency={currencyCode ?? ''}
        isCurrentMonth={isCurrent}
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
        {...pullToRefresh}
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg.canvas,
  },
  sectionHeader: {
    ...type.caption,
    color: color.text.tertiary,
    backgroundColor: color.bg.canvas,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
});
