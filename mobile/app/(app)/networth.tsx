import type { MarketQuotePoint } from '@expense-tracker/shared';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Card, SectionTitle } from '@/components/Card';
import { AppBar, IconButton } from '@/components/Chrome';
import { FadeInUp } from '@/components/FadeInUp';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useGoalsList, useTrades, useUserCurrency } from '@/db/hooks';
import { formatDong } from '@/invest/investModel';
import {
  type Snapshot,
  buildNetWorthSeries,
  readSnapshots,
  recordSnapshot,
} from '@/invest/netWorth';
import { PriceChart } from '@/invest/PriceChart';
import { useSelectedMonth } from '@/month/MonthProvider';
import { goBack } from '@/navigation/goBack';
import { useOptionalSyncStatus } from '@/sync/SyncProvider';
import { createStyles, useColors } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

export const NETWORTH_TOTAL_TEST_ID = 'networth-total';
export const NETWORTH_CHART_TEST_ID = 'networth-chart';
export const NETWORTH_SAVINGS_TEST_ID = 'networth-savings';
export const NETWORTH_STOCKS_TEST_ID = 'networth-stocks';
export const NETWORTH_NOTE_TEST_ID = 'networth-note';
export const NETWORTH_VND_ONLY_TEST_ID = 'networth-vnd-only';

/**
 * Net worth: the savings held in goals plus what the stocks are worth, now and day by day. The stocks' history is
 * rebuilt from the trades and the closing prices; the savings' history is the daily reading taken since it began to
 * be recorded, so the chart starts where both are known (`invest/netWorth.ts`).
 */
export default function NetWorthScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const database = useDatabase();
  const { today } = useSelectedMonth();
  const status = useOptionalSyncStatus();
  const offline = status !== null && !status.reachable;
  const currency = useUserCurrency();
  const goals = useGoalsList();
  const trades = useTrades();

  const savings = useMemo(
    () =>
      (goals.data ?? [])
        .filter((g) => g.currency === 'VND')
        .reduce((sum, g) => sum + g.savedMinor, 0),
    [goals.data],
  );
  const [snapshots, setSnapshots] = useState<readonly Snapshot[]>([]);
  useEffect(() => {
    if (goals.data === undefined || currency.data !== 'VND') return;
    let cancelled = false;
    void recordSnapshot(database, today, savings)
      .then(() => readSnapshots(database))
      .then((list) => {
        if (!cancelled) setSnapshots(list);
      });
    return () => {
      cancelled = true;
    };
  }, [database, today, savings, goals.data, currency.data]);

  // Every symbol ever traded: a stock sold since still shaped the days it was held.
  const symbols = useMemo(
    () => [...new Set((trades.data ?? []).map((t) => t.symbol))],
    [trades.data],
  );
  const [series, setSeries] = useState<Record<string, readonly MarketQuotePoint[]>>({});
  const [round, setRound] = useState(0);
  const key = symbols.join(',');
  useEffect(() => {
    if (offline || key === '') return;
    let cancelled = false;
    void Promise.all(
      key.split(',').map(async (symbol): Promise<[string, readonly MarketQuotePoint[]]> => {
        try {
          return [symbol, (await api.getMarketQuote(symbol)).data.series];
        } catch {
          return [symbol, []];
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setSeries(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [api, key, offline, round]);

  const built = useMemo(
    () => buildNetWorthSeries({ trades: trades.data ?? [], series, snapshots }),
    [trades.data, series, snapshots],
  );
  const last = built.points.at(-1);
  const stocksNow = last === undefined ? null : last.close - (snapshots.at(-1)?.savingsMinor ?? 0);
  const total = last?.close ?? savings;
  const hasStocks = (trades.data ?? []).length > 0;

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.netWorth.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => goBack(router, '/(app)/(tabs)/summary')}
            tint={color.text.primary}
            testID="networth-back"
          />
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => setRound((n) => n + 1)} />
        }
      >
        {currency.data !== undefined && currency.data !== 'VND' ? (
          <Text style={styles.muted} testID={NETWORTH_VND_ONLY_TEST_ID}>
            {COPY.netWorth.vndOnly}
          </Text>
        ) : (
          <>
            <FadeInUp>
              <Card>
                <View style={styles.hero}>
                  <Text style={styles.label}>{COPY.netWorth.now}</Text>
                  <Text
                    style={styles.big}
                    testID={NETWORTH_TOTAL_TEST_ID}
                    accessibilityRole="header"
                  >
                    {formatDong(total)}
                  </Text>
                </View>
              </Card>
            </FadeInUp>

            {built.points.length >= 2 ? (
              <Card testID={NETWORTH_CHART_TEST_ID}>
                <View style={styles.chart}>
                  <PriceChart series={built.points} format={formatDong} />
                </View>
              </Card>
            ) : (
              <Text style={styles.muted}>
                {offline && hasStocks ? COPY.netWorth.offline : COPY.netWorth.chartEmpty}
              </Text>
            )}

            <SectionTitle>{COPY.netWorth.title}</SectionTitle>
            <Card>
              <Row testID={NETWORTH_SAVINGS_TEST_ID} lastInGroup={!hasStocks}>
                <RowTitle>{COPY.netWorth.savings}</RowTitle>
                <RowSubtitle>{formatDong(savings)}</RowSubtitle>
              </Row>
              {hasStocks ? (
                <Row testID={NETWORTH_STOCKS_TEST_ID} lastInGroup>
                  <RowTitle>{COPY.netWorth.stocks}</RowTitle>
                  <RowSubtitle>{stocksNow === null ? '—' : formatDong(stocksNow)}</RowSubtitle>
                </Row>
              ) : null}
            </Card>

            {built.savingsFrom !== null && built.points.length > 0 ? (
              <Text style={styles.muted} testID={NETWORTH_NOTE_TEST_ID}>
                {COPY.netWorth.savingsFrom.replace('{date}', built.savingsFrom)}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    content: { gap: space[3], paddingTop: space[3], paddingBottom: space[6] },
    hero: { padding: space[5], gap: space[2] },
    label: { ...type.subhead, color: color.text.secondary },
    big: { ...type.amountHero, fontVariant: ['tabular-nums'], color: color.text.primary },
    chart: { padding: space[4] },
    muted: { ...type.callout, color: color.text.secondary, paddingHorizontal: space[4] },
  }),
);
