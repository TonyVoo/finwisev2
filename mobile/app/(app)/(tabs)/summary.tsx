import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppBar } from '@/components/Chrome';
import { COPY } from '@/copy/strings';
import { useMonthCategorySpend, useSpendTrend, useUserCurrency } from '@/db/hooks';
import { MonthTotal } from '@/expenses/MonthTotal';
import { useFirstPaintSkeleton } from '@/expenses/useFirstPaint';
import { useAwaitingFirstSync } from '@/sync/useAwaitingFirstSync';
import { MonthSwitcher } from '@/month/MonthSwitcher';
import { useSelectedMonth } from '@/month/MonthProvider';
import { CategoryDonut } from '@/summary/CategoryDonut';
import { SpendLegend } from '@/summary/SpendLegend';
import { InsightsCard } from '@/summary/InsightsCard';
import { buildInsights } from '@/summary/insightsModel';
import { stepMonth, monthLabel } from '@/lib/calendar';
import { SpendTrend } from '@/summary/SpendTrend';
import { buildTrend } from '@/summary/trendModel';
import { SummaryEmpty, SummarySkeleton } from '@/summary/SummaryStates';
import { summariseMonth } from '@/summary/summaryModel';
import { SyncIndicator } from '@/sync/SyncIndicator';
import { usePullToRefresh } from '@/sync/usePullToRefresh';
import { createStyles } from '@/theme/ThemeProvider';

export const SUMMARY_SCROLL_TEST_ID = 'summary-scroll';

/**
 * The monthly summary: `docs/design/08-monthly-summary.md`.
 *
 * Answers "where did my money go this month?" with one total and one chart, on one screen,
 * with no interaction required.
 *
 * ### One query feeds everything here
 *
 * The total, the expense count, the donut and the legend all come off a single
 * `GROUP BY` over local SQLite (`useMonthCategorySpend`). That is rule 1, and it is a
 * correctness property rather than an optimisation: the total is the sum of the group
 * totals and the count is the sum of their counts, so the four figures on screen cannot
 * disagree with each other. Reading the total from Home's own query instead would be a
 * second aggregate over the same rows, and two aggregates can drift - which is exactly the
 * failure `TVO-31` was filed for, reached from the other direction.
 *
 * ### What this screen cannot do
 *
 * - **It cannot fail.** Every number is local, there is no server reporting endpoint in
 *   the MVP, so there is no error state to design for and none implemented. A sync
 *   transport failure belongs in the sync pill and must not blank or grey the chart:
 *   stale-but-real numbers beat an error screen.
 * - **It cannot show a different month from Home.** The selection lives above the tabs in
 *   `MonthProvider` (`05-month-switcher.md` rule 7), so switching month here and returning
 *   to Expenses shows the same month, and neither tab can label a figure "this month" and
 *   mean a different one.
 * - **It cannot go stale after a local write.** Every read is invalidated as part of the
 *   write (`db/localWrite.ts`), so adding an expense on the other tab and switching here
 *   shows it immediately - rule 10, re-run on change rather than on a timer or on focus.
 *
 * ### What sync is allowed to do to this screen
 *
 * Two things, and nothing else. The pill (element 3) reports connectivity in the app bar,
 * exactly as it does on Home - this is one of the two screens `02-offline-and-sync.md` §3
 * puts it on. And a pull triggers a sync (rule 12), which may bring rows in from another
 * device and so change the figures; it does not re-read anything, because the reads are
 * already current. Neither can take the numbers away: a transport failure lives in the
 * pill, and stale-but-real figures beat an error screen.
 *
 * One piece of the spec is still not here: the legend's drill-down to a filtered Expenses
 * tab (rule 8), which needs a category filter the list screen does not have. Nothing is
 * stubbed in its place.
 */
export default function SummaryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const { month, isCurrent } = useSelectedMonth();

  const [scrolled, setScrolled] = useState(false);
  const pullToRefresh = usePullToRefresh();

  const spend = useMonthCategorySpend(month);
  const currency = useUserCurrency();
  const trendRows = useSpendTrend(month);
  const previousMonth = stepMonth(month, -1);
  const previousSpend = useMonthCategorySpend(previousMonth);

  // The frame or two before the first read returns, abandoned after 300ms whatever happens
  // - after that the honest answer is `empty`, not `loading` (`useFirstPaintSkeleton`).
  const showSkeleton = useFirstPaintSkeleton(spend.isPending || currency.isPending);

  const summary = summariseMonth(spend.data ?? []);
  const trend = buildTrend(trendRows.data ?? [], month);

  // `undefined` while the read is in flight, `null` when there is no user row. Neither is a
  // currency, and formatting an amount without one would put a dollar sign in front of a
  // euro figure - so both hold the whole screen on its skeleton (`db/hooks.ts`).
  const currencyCode = currency.data ?? null;
  // Also held while no sync has ever completed and nothing is local (`useAwaitingFirstSync`).
  const awaitingFirstSync = useAwaitingFirstSync();
  const pending = showSkeleton || currencyCode === null || awaitingFirstSync;

  return (
    <View style={styles.screen}>
      {/* The pill, in the same trailing slot as on Home (§3): the one place this screen
          mentions connectivity, and the only thing it knows about sync. */}
      <AppBar title={COPY.summary.title} elevated={scrolled} trailing={<SyncIndicator />} />

      {/* Pinned, exactly as on Home, and reading the same shared selection. */}
      <MonthSwitcher onOpenPicker={() => router.push('/(app)/month-picker')} />

      <ScrollView
        testID={SUMMARY_SCROLL_TEST_ID}
        onScroll={(event) => setScrolled(event.nativeEvent.contentOffset.y > 0)}
        scrollEventThrottle={16}
        // Rule 12, as on Home. The figures do not change as a result unless the sync
        // brings in rows from another device.
        //
        // `TVO-37`: a built control, not the two list props. This is a plain `ScrollView`,
        // which has no `refreshing`/`onRefresh` - spreading them here dropped both on the
        // floor and left the gesture inert on this tab.
        refreshControl={pullToRefresh.refreshControl}
        contentContainerStyle={styles.content}
      >
        {/* Renders in every state, including `empty`, where it is `$0.00` and `0 expenses`.
            Hiding it there would make the figure appear to pop into existence later. */}
        <MonthTotal
          totalMinor={pending ? undefined : summary.totalMinor}
          currency={currencyCode ?? ''}
          isCurrentMonth={isCurrent}
          count={pending ? undefined : summary.expenseCount}
        />

        {pending ? (
          <SummarySkeleton />
        ) : summary.hasExpenses ? (
          <>
            {/* Rule 11: only when the month total is positive. A month of zero-amount
                expenses - which sync can deliver - keeps its legend and loses its ring
                rather than drawing an empty one. */}
            {summary.isChartable ? (
              <CategoryDonut
                entries={summary.entries}
                totalMinor={summary.totalMinor}
                currency={currencyCode}
                month={month}
              />
            ) : null}
            <SpendLegend entries={summary.entries} currency={currencyCode} />
          </>
        ) : (
          <SummaryEmpty />
        )}

        {!pending && currencyCode !== null && previousSpend.data !== undefined ? (
          <InsightsCard
            insights={buildInsights(spend.data ?? [], previousSpend.data)}
            previousLabel={monthLabel(previousMonth).split(' ')[0] ?? ''}
            currency={currencyCode}
          />
        ) : null}

        {/* Below the month's own figures, and shown even for an empty month: "nothing this month"
            is context the trend gives. Held back until there are two months to compare. */}
        {!pending && currencyCode !== null && trend.isWorthShowing ? (
          <SpendTrend trend={trend} currency={currencyCode} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: color.bg.canvas,
    },
    content: {
      // The legend is what scrolls when it is long (rule 7); nothing above it is cropped.
      flexGrow: 1,
    },
  }),
);
