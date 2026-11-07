import { useTabBarClearance } from '@/navigation/tabBar';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApiClient } from '@/bootstrap/AppProviders';
import { AppBar, IconButton } from '@/components/Chrome';
import { Card } from '@/components/Card';
import { IconBadge } from '@/components/IconBadge';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { COPY } from '@/copy/strings';
import {
  useGoalsList,
  useTrades,
  useLiveCategories,
  useMonthlyLimit,
  useIncomeTrend,
  useMonthCategorySpend,
  useMonthIncome,
  useSpendTrend,
  useUserCurrency,
} from '@/db/hooks';
import { useDatabase } from '@/db/DatabaseProvider';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import { useLocalWrite } from '@/db/localWrite';
import { updateCategory } from '@/db/mutations';
import { useSnackbar } from '@/components/Snackbar';
import { buildStocksBlock } from '@/summary/monthReport';
import { monthReportHtml } from '@/summary/monthReportHtml';
import { useOptionalSyncStatus } from '@/sync/SyncProvider';
import { BudgetSuggestionsCard } from '@/summary/BudgetSuggestionsCard';
import { type BudgetSuggestion, suggestBudgets, suggestLimit } from '@/summary/budgetSuggest';
import { MonthTotal } from '@/expenses/MonthTotal';
import { useFirstPaintSkeleton } from '@/expenses/useFirstPaint';
import { useAwaitingFirstSync } from '@/sync/useAwaitingFirstSync';
import { MonthSwitcher } from '@/month/MonthSwitcher';
import { useSelectedMonth } from '@/month/MonthProvider';
import { CategoryDonut } from '@/summary/CategoryDonut';
import { SpendLegend } from '@/summary/SpendLegend';
import { InsightsCard } from '@/summary/InsightsCard';
import {
  buildInsights,
  daysLeftInMonth,
  insightText,
  monthProgress,
} from '@/summary/insightsModel';
import { RecapSection } from '@/summary/RecapSection';
import { monthName, stepMonth } from '@/lib/calendar';
import { SpendTrend } from '@/summary/SpendTrend';
import { buildTrend } from '@/summary/trendModel';
import { SummaryEmpty, SummarySkeleton } from '@/summary/SummaryStates';
import { summariseMonth } from '@/summary/summaryModel';
import { SyncIndicator } from '@/sync/SyncIndicator';
import { usePullToRefresh } from '@/sync/usePullToRefresh';
import { createStyles } from '@/theme/ThemeProvider';

export const SUMMARY_SCROLL_TEST_ID = 'summary-scroll';
export const SUMMARY_SHARE_TEST_ID = 'summary-share';

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
  // The floating tab bar covers the bottom of the screen; the last card has to clear it.
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const { month, isCurrent, today } = useSelectedMonth();

  const [scrolled, setScrolled] = useState(false);
  const pullToRefresh = usePullToRefresh();

  const spend = useMonthCategorySpend(month);
  const currency = useUserCurrency();
  const trendRows = useSpendTrend(month);
  const income = useMonthIncome(month);
  const previousMonth = stepMonth(month, -1);
  const previousSpend = useMonthCategorySpend(previousMonth);
  const previousIncome = useMonthIncome(previousMonth);
  // The two months before that, so a "typical month" has a few to average (`18-forecast-and-unusual-spend.md`).
  const olderSpend = useMonthCategorySpend(stepMonth(month, -2));
  const oldestSpend = useMonthCategorySpend(stepMonth(month, -3));

  // The frame or two before the first read returns, abandoned after 300ms whatever happens
  // - after that the honest answer is `empty`, not `loading` (`useFirstPaintSkeleton`).
  const showSkeleton = useFirstPaintSkeleton(spend.isPending || currency.isPending);

  const summary = summariseMonth(spend.data ?? []);
  const incomeTrendRows = useIncomeTrend(month);
  const trend = buildTrend(trendRows.data ?? [], month, incomeTrendRows.data ?? []);

  // `undefined` while the read is in flight, `null` when there is no user row. Neither is a
  // currency, and formatting an amount without one would put a dollar sign in front of a
  // euro figure - so both hold the whole screen on its skeleton (`db/hooks.ts`).
  const currencyCode = currency.data ?? null;
  // Also held while no sync has ever completed and nothing is local (`useAwaitingFirstSync`).
  const awaitingFirstSync = useAwaitingFirstSync();
  const pending = showSkeleton || currencyCode === null || awaitingFirstSync;

  // Worked out once: the card shows these sentences, and the recap is asked to reword exactly them.
  const insights =
    !pending &&
    currencyCode !== null &&
    previousSpend.data !== undefined &&
    olderSpend.data !== undefined &&
    oldestSpend.data !== undefined
      ? buildInsights(
          spend.data ?? [],
          previousSpend.data,
          { current: income.data ?? 0, previous: previousIncome.data ?? 0 },
          isCurrent ? daysLeftInMonth(today) : null,
          {
            // The forecast and the unusual line are for the month still going on.
            progress: isCurrent ? monthProgress(today) : null,
            history: [previousSpend.data, olderSpend.data, oldestSpend.data],
          },
        )
      : [];
  const insightSentences = insights.map((insight) =>
    insightText(insight, COPY.summary.insights, monthName(previousMonth), currencyCode ?? ''),
  );

  // Budget suggestions: from the three months before this one, offered in the month still going on.
  const database = useDatabase();
  const localWrite = useLocalWrite();
  const showSnackbar = useSnackbar();
  const categories = useLiveCategories();
  const monthlyLimit = useMonthlyLimit();
  const [dismissedIn, setDismissedIn] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readMeta(database, META_KEYS.budgetSuggestDismissed).then((value) => {
      if (!cancelled) setDismissedIn(value);
    });
    return () => {
      cancelled = true;
    };
  }, [database]);
  const histories = useMemo(
    () =>
      previousSpend.data === undefined ||
      olderSpend.data === undefined ||
      oldestSpend.data === undefined
        ? null
        : [previousSpend.data, olderSpend.data, oldestSpend.data],
    [previousSpend.data, olderSpend.data, oldestSpend.data],
  );
  const suggestions = useMemo(() => {
    if (histories === null || categories.data === undefined) return [];
    return suggestBudgets(
      categories.data.map((category) => ({
        categoryId: category.id,
        name: category.name,
        months: histories.map(
          (rows) => rows.find((row) => row.categoryId === category.id)?.totalMinor ?? 0,
        ),
        currentMinor: category.monthlyBudgetMinor,
      })),
    );
  }, [histories, categories.data]);
  const limitSuggestion = useMemo(() => {
    if (histories === null) return null;
    const totals = histories.map((rows) => rows.reduce((sum, row) => sum + row.totalMinor, 0));
    const suggestedMinor = suggestLimit(totals, monthlyLimit.limitMinor);
    if (suggestedMinor === null) return null;
    const spent = totals.filter((t) => t > 0);
    return {
      suggestedMinor,
      averageMinor: Math.round(spent.reduce((a, b) => a + b, 0) / spent.length),
    };
  }, [histories, monthlyLimit.limitMinor]);
  // The month as a PDF, made on the phone and handed to the share sheet (as the year report is).
  const api = useApiClient();
  const syncStatus = useOptionalSyncStatus();
  const goals = useGoalsList();
  const trades = useTrades();
  const [sharing, setSharing] = useState(false);
  async function shareReport(): Promise<void> {
    if (currencyCode === null || sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        showSnackbar({ message: COPY.summary.report.unavailable });
        return;
      }
      const online = syncStatus === null || syncStatus.reachable;
      const stocks =
        currencyCode === 'VND' && online && (trades.data ?? []).length > 0
          ? await buildStocksBlock(api, trades.data ?? [])
          : null;
      const html = monthReportHtml({
        month,
        currency: currencyCode,
        spentMinor: summary.totalMinor,
        incomeMinor: income.data ?? 0,
        entries: summary.entries,
        goals: goals.data ?? [],
        stocks,
        insights: insightSentences,
        madeOn: today,
      });
      const file = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch {
      showSnackbar({ message: COPY.summary.report.failed });
    } finally {
      setSharing(false);
    }
  }

  const showSuggestions = isCurrent && !pending && currencyCode !== null && dismissedIn !== month;

  async function useSuggestion(suggestion: BudgetSuggestion): Promise<void> {
    await localWrite((db) =>
      updateCategory(db, suggestion.categoryId, { monthlyBudgetMinor: suggestion.suggestedMinor }),
    );
    showSnackbar({ message: COPY.summary.suggest.applied });
  }
  async function useAll(): Promise<void> {
    await localWrite(async (db) => {
      for (const suggestion of suggestions) {
        await updateCategory(db, suggestion.categoryId, {
          monthlyBudgetMinor: suggestion.suggestedMinor,
        });
      }
    });
    if (limitSuggestion !== null) await monthlyLimit.setLimit(limitSuggestion.suggestedMinor);
    showSnackbar({ message: COPY.summary.suggest.applied });
  }
  async function later(): Promise<void> {
    setDismissedIn(month);
    await writeMeta(database, META_KEYS.budgetSuggestDismissed, month);
  }

  return (
    <View style={styles.screen}>
      {/* The pill, in the same trailing slot as on Home (§3): the one place this screen
          mentions connectivity, and the only thing it knows about sync. */}
      <AppBar
        large
        title={COPY.summary.title}
        elevated={scrolled}
        trailing={
          <>
            <SyncIndicator />
            <IconButton
              icon="share"
              label={COPY.summary.report.share}
              onPress={() => void shareReport()}
              testID={SUMMARY_SHARE_TEST_ID}
            />
          </>
        }
      />

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
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
      >
        {/* Renders in every state, including `empty`, where it is `$0.00` and `0 expenses`.
            Hiding it there would make the figure appear to pop into existence later. */}
        <MonthTotal
          totalMinor={pending ? undefined : summary.totalMinor}
          currency={currencyCode ?? ''}
          isCurrentMonth={isCurrent}
          count={pending ? undefined : summary.expenseCount}
          incomeMinor={pending ? undefined : income.data}
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

        {insights.length > 0 && currencyCode !== null ? (
          <InsightsCard
            insights={insights}
            previousLabel={monthName(previousMonth)}
            currency={currencyCode}
          >
            <RecapSection month={month} facts={insightSentences} />
          </InsightsCard>
        ) : null}

        {showSuggestions && currencyCode !== null ? (
          <BudgetSuggestionsCard
            suggestions={suggestions}
            limit={limitSuggestion}
            currency={currencyCode}
            onUse={(s) => void useSuggestion(s)}
            onUseLimit={(minor) => void monthlyLimit.setLimit(minor)}
            onUseAll={() => void useAll()}
            onLater={() => void later()}
          />
        ) : null}

        {/* Below the month's own figures, and shown even for an empty month: "nothing this month"
            is context the trend gives. Held back until there are two months to compare. */}
        {!pending && currencyCode !== null && trend.isWorthShowing ? (
          <SpendTrend trend={trend} currency={currencyCode} />
        ) : null}

        {/* The whole year, one tap away from the month. */}
        <View style={styles.yearGap} />
        <Card>
          {currencyCode === 'VND' ? (
            <Row
              testID="summary-networth"
              leading={<IconBadge name="trending-up" />}
              onPress={() => router.push('/(app)/networth')}
              chevron
              accessibilityLabel={`${COPY.netWorth.title}. ${COPY.netWorth.hint}`}
            >
              <RowTitle>{COPY.netWorth.title}</RowTitle>
              <RowSubtitle lines={2}>{COPY.netWorth.hint}</RowSubtitle>
            </Row>
          ) : null}
          <Row
            testID="summary-year"
            leading={<IconBadge name="calendar" />}
            onPress={() => router.push('/(app)/year')}
            chevron
            lastInGroup
            accessibilityLabel={`${COPY.yearReport.title}. ${COPY.yearReport.hint}`}
          >
            <RowTitle>{COPY.yearReport.title}</RowTitle>
            <RowSubtitle lines={2}>{COPY.yearReport.hint}</RowSubtitle>
          </Row>
        </Card>
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
    yearGap: { height: 16 },
    content: {
      // The legend is what scrolls when it is long (rule 7); nothing above it is cropped.
      flexGrow: 1,
    },
  }),
);
