import Feather from '@expo/vector-icons/Feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { PositionSize } from '@expense-tracker/shared';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiRequestError } from '@/api/errors';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AppBar } from '@/components/Chrome';
import { FadeInUp } from '@/components/FadeInUp';
import { FormBanner } from '@/components/FormBanner';
import { IconBadge } from '@/components/IconBadge';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { TextField } from '@/components/TextField';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useTrades } from '@/db/hooks';
import { AlertSheet } from '@/invest/AlertSheet';
import { type PriceAlert, addAlert, readAlerts, rearm, removeAlert } from '@/invest/alerts';
import { ChangePill } from '@/invest/ChangePill';
import {
  cleanSymbol,
  fillTemplate,
  formatDong as vnd,
  formatSignedDong as signed,
  formatShare,
  groupDigits,
  readCalc,
} from '@/invest/investModel';
import { buildPortfolio } from '@/invest/portfolioModel';
import { NewsSection } from '@/invest/NewsSection';
import { PriceChart } from '@/invest/PriceChart';
import { QuoteSkeleton } from '@/invest/QuoteSkeleton';
import { RangeBar } from '@/invest/RangeBar';
import { ScoreMeter, scoreTone } from '@/invest/ScoreMeter';
import { SearchField } from '@/invest/SearchField';
import { SymbolAvatar } from '@/invest/SymbolAvatar';
import { useStockLookup } from '@/invest/useStockLookup';
import { readWatchlist, unwatch, watch } from '@/invest/watchlist';
import { keyHaptic, savedHaptic, warnHaptic } from '@/lib/haptics';
import { useTabBarClearance } from '@/navigation/tabBar';
import { useOptionalSyncStatus } from '@/sync/SyncProvider';
import { createStyles, useColors } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

export const INVEST_SCROLL_TEST_ID = 'invest-scroll';

/**
 * The Investing tab: look up a Vietnamese stock, see its screening score, and size a position.
 *
 * Everything here is read from the server and kept nowhere: no SQLite, no sync, nothing to
 * conflict. The tab can be wholly unavailable (the market service is optional) and the rest of
 * the app does not notice. Two things it must always do: say so when the prices are simulated
 * (`demo`), and keep the "not investment advice" line on screen.
 */
/** `Above ₫60.000` / `Below ₫52.000`. */
function alertLine(alert: PriceAlert): string {
  return fillTemplate(
    alert.direction === 'above' ? COPY.invest.alertAboveLine : COPY.invest.alertBelowLine,
    { price: vnd(alert.price) },
  );
}

export default function InvestScreen() {
  const styles = useStyles();
  const color = useColors();
  const api = useApiClient();
  const clearance = useTabBarClearance();
  const status = useOptionalSyncStatus();
  const offline = status !== null && !status.reachable;

  const [symbolText, setSymbolText] = useState('');
  // What is in the field right now. Return can arrive before the render that follows the last keystroke, so a
  // handler built from state would look up what was typed one key ago.
  const typed = useRef('');
  const { state, lookup } = useStockLookup(api);

  const database = useDatabase();
  const router = useRouter();
  const trades = useTrades();
  const book = buildPortfolio(trades.data ?? []);
  const openPositions = book.open.length;
  const [watched, setWatched] = useState<readonly string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void readWatchlist(database).then((list) => {
      if (!cancelled) setWatched(list);
    });
    return () => {
      cancelled = true;
    };
  }, [database]);

  const [alerts, setAlerts] = useState<readonly PriceAlert[]>([]);
  const [alertOpen, setAlertOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readAlerts(database).then((list) => {
      if (!cancelled) setAlerts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [database]);

  const [capital, setCapital] = useState('');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [calcError, setCalcError] = useState<string | undefined>(undefined);
  const [sizing, setSizing] = useState(false);
  const [size, setSize] = useState<PositionSize | null>(null);
  const [sizeFailed, setSizeFailed] = useState(false);

  const ready = state.status === 'ready' ? state : null;

  function typeSymbol(text: string): void {
    typed.current = text.toUpperCase();
    setSymbolText(typed.current);
  }

  async function search(): Promise<void> {
    const target = cleanSymbol(typed.current);
    if (target === null) return;
    typeSymbol(target);
    await lookup(target);
  }

  async function pick(picked: string): Promise<void> {
    keyHaptic();
    typeSymbol(picked);
    if (!offline) await lookup(picked);
  }

  async function toggleWatch(picked: string): Promise<void> {
    keyHaptic();
    setWatched(
      watched.includes(picked) ? await unwatch(database, picked) : await watch(database, picked),
    );
  }

  async function saveAlert(direction: 'above' | 'below', price: number): Promise<void> {
    if (ready === null) return;
    setAlerts(await addAlert(database, ready.quote.symbol, direction, price));
    setAlertOpen(false);
  }

  /** The quote's close as the entry, and the suggested stop (if there is one) as the stop-loss. */
  function usePrices(): void {
    if (ready === null) return;
    keyHaptic();
    setEntry(groupDigits(String(Math.round(ready.quote.close))));
    if (ready.signal !== null && ready.signal.suggestedStop !== null) {
      setStop(groupDigits(String(Math.round(ready.signal.suggestedStop))));
    }
    setSize(null);
    setCalcError(undefined);
  }

  async function calculate(): Promise<void> {
    const read = readCalc(capital, entry, stop);
    setSize(null);
    setSizeFailed(false);
    if (!read.ok) {
      warnHaptic();
      setCalcError(COPY.invest[read.problem]);
      return;
    }
    setCalcError(undefined);
    setSizing(true);
    try {
      const { data } = await api.getPositionSize(read.input);
      setSize(data);
      savedHaptic();
    } catch (error) {
      warnHaptic();
      if (error instanceof ApiRequestError && error.code === 'validation_error') {
        setCalcError(COPY.invest.stopBelowEntry);
      } else {
        setSizeFailed(true);
      }
    } finally {
      setSizing(false);
    }
  }

  // The stocks worth hearing about: what is held, what is watched, and what is being looked at.
  const newsSymbols = [
    ...new Set([
      ...book.open.map((position) => position.symbol),
      ...watched,
      ...(ready === null ? [] : [ready.quote.symbol]),
    ]),
  ].slice(0, 20);

  const portfolioSubtitle =
    openPositions === 0
      ? COPY.portfolio.entryEmpty
      : openPositions === 1
        ? COPY.portfolio.positionsOne
        : fillTemplate(COPY.portfolio.positionsMany, { count: openPositions });

  const changeMove =
    ready !== null && ready.quote.prevClose !== null
      ? ready.quote.close - ready.quote.prevClose
      : null;
  const tone = ready?.signal ? scoreTone(ready.signal.score) : 'none';
  const toneColor =
    tone === 'strong'
      ? color.success.default
      : tone === 'middling'
        ? color.warning.default
        : color.danger.default;
  const toneFill =
    tone === 'strong'
      ? color.success.subtle
      : tone === 'middling'
        ? color.warning.subtle
        : color.danger.subtle;

  return (
    <View style={styles.screen}>
      <AppBar large title={COPY.invest.title} />
      <ScrollView
        testID={INVEST_SCROLL_TEST_ID}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingBottom: clearance + space[4] }]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              if (ready !== null && !offline) void lookup(ready.quote.symbol);
            }}
            tintColor={color.text.tertiary}
          />
        }
      >
        <View style={styles.block}>
          <SearchField
            value={symbolText}
            onChangeText={typeSymbol}
            onSubmit={() => void search()}
            busy={state.status === 'loading'}
            disabled={offline}
            {...(offline ? { disabledReason: COPY.invest.offline } : {})}
          />
        </View>

        {watched.length > 0 ? (
          <View style={styles.watch} testID="invest-watchlist">
            <View style={styles.block}>
              <Text style={styles.sectionTitle}>{COPY.invest.watchlistTitle}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.chips}
            >
              {watched.map((item) => {
                const active = item === ready?.quote.symbol;
                return (
                  <Pressable
                    key={item}
                    testID={`invest-watch-${item}`}
                    onPress={() => void pick(item)}
                    accessibilityRole="button"
                    accessibilityLabel={item}
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.chip,
                      active ? styles.chipActive : null,
                      pressed ? { opacity: 0.7 } : null,
                    ]}
                  >
                    <SymbolAvatar symbol={item} size={24} />
                    <Text
                      style={[styles.chipText, active ? { color: color.primary.default } : null]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {state.status === 'loading' ? <QuoteSkeleton /> : null}

        {state.status === 'failed' ? (
          <View style={styles.block}>
            <FormBanner
              testID="invest-unavailable"
              message={state.reason === 'notFound' ? COPY.invest.notFound : COPY.invest.unavailable}
            />
          </View>
        ) : null}

        {ready && state.status === 'ready' ? (
          <>
            {ready.quote.demo ? (
              <View style={styles.block}>
                <FormBanner testID="invest-demo" message={COPY.invest.demoBanner} />
              </View>
            ) : null}

            <FadeInUp key={`quote-${ready.quote.symbol}`}>
              <Card>
                <View style={styles.cardBody} testID="invest-quote">
                  <View style={styles.heroTop}>
                    <SymbolAvatar symbol={ready.quote.symbol} size={44} />
                    <View style={styles.heroName}>
                      <Text style={styles.symbol}>{ready.quote.symbol}</Text>
                      <Text style={styles.caption}>
                        {fillTemplate(COPY.invest.asOf, { date: ready.quote.asOf })}
                      </Text>
                    </View>
                    <Pressable
                      testID="invest-alert-add"
                      onPress={() => {
                        keyHaptic();
                        setAlertOpen(true);
                      }}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={COPY.invest.alertAdd}
                      style={styles.star}
                    >
                      <Feather name="bell" size={22} color={color.text.tertiary} />
                    </Pressable>
                    <Pressable
                      testID="invest-watch-toggle"
                      onPress={() => void toggleWatch(ready.quote.symbol)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={
                        watched.includes(ready.quote.symbol)
                          ? COPY.invest.unwatch
                          : COPY.invest.watch
                      }
                      accessibilityState={{ selected: watched.includes(ready.quote.symbol) }}
                      style={styles.star}
                    >
                      <Ionicons
                        name={watched.includes(ready.quote.symbol) ? 'star' : 'star-outline'}
                        size={24}
                        color={
                          watched.includes(ready.quote.symbol)
                            ? color.warning.default
                            : color.text.tertiary
                        }
                      />
                    </Pressable>
                  </View>

                  <View style={styles.priceRow}>
                    <Text style={styles.price} accessibilityRole="header">
                      {vnd(ready.quote.close)}
                    </Text>
                  </View>
                  <View style={styles.moveRow}>
                    <ChangePill fraction={ready.quote.changePct} />
                    {changeMove === null ? null : (
                      <Text style={styles.caption}>{signed(changeMove)}</Text>
                    )}
                  </View>

                  <PriceChart series={ready.quote.series} format={vnd} />

                  <View style={styles.divider} />
                  <RangeBar
                    close={ready.quote.close}
                    low={ready.quote.low52w}
                    high={ready.quote.high52w}
                    format={vnd}
                  />
                </View>
              </Card>
            </FadeInUp>

            {ready.signal !== null ? (
              <FadeInUp key={`signal-${ready.quote.symbol}`} delay={80}>
                <Card>
                  <View style={styles.cardBody} testID="invest-signal">
                    <View style={styles.scoreHead}>
                      <Text style={styles.title}>{COPY.invest.signalTitle}</Text>
                      <View style={[styles.tonePill, { backgroundColor: toneFill }]}>
                        <Text style={[styles.toneText, { color: toneColor }]}>
                          {ready.signal.label}
                        </Text>
                      </View>
                    </View>
                    {ready.signal.score === null ? null : (
                      <Text style={styles.scoreLine}>
                        <Text style={styles.scoreNumber}>{Math.round(ready.signal.score)}</Text>
                        <Text style={styles.caption}>{' / 100'}</Text>
                      </Text>
                    )}
                    <ScoreMeter score={ready.signal.score} />

                    {ready.signal.reasons.map((reason) => (
                      <View key={reason} style={styles.bullet}>
                        <View style={styles.bulletDot} />
                        <Text style={styles.body}>{reason}</Text>
                      </View>
                    ))}
                    {ready.signal.warnings.map((warning) => (
                      <View key={warning} style={styles.bullet}>
                        <Feather name="alert-triangle" size={14} color={color.warning.default} />
                        <Text style={[styles.body, { color: color.warning.default }]}>
                          {warning}
                        </Text>
                      </View>
                    ))}

                    {ready.signal.suggestedStop !== null ? (
                      <View style={styles.stopRow}>
                        <Feather name="shield" size={16} color={color.text.secondary} />
                        <Text style={styles.caption}>
                          {fillTemplate(COPY.invest.suggestedStop, {
                            price: vnd(ready.signal.suggestedStop),
                          })}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Card>
              </FadeInUp>
            ) : null}
          </>
        ) : null}

        <NewsSection api={api} symbols={newsSymbols} offline={offline} />

        {alerts.length > 0 ? (
          <View style={styles.alerts} testID="invest-alerts">
            <View style={styles.block}>
              <Text style={styles.sectionTitle}>{COPY.invest.alertsTitle}</Text>
            </View>
            <Card>
              {alerts.map((alert, index) => (
                <Row
                  key={alert.id}
                  testID={`invest-alert-${alert.id}`}
                  leading={<SymbolAvatar symbol={alert.symbol} />}
                  lastInGroup={index === alerts.length - 1}
                  onPress={
                    alert.firedAt === null
                      ? undefined
                      : async () => setAlerts(await rearm(database, alert.id))
                  }
                  accessibilityLabel={`${alert.symbol}, ${alertLine(alert)}`}
                  accessibilityHint={alert.firedAt === null ? undefined : COPY.invest.alertAgain}
                  trailing={
                    <Pressable
                      testID={`invest-alert-remove-${alert.id}`}
                      onPress={async () => {
                        keyHaptic();
                        setAlerts(await removeAlert(database, alert.id));
                      }}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={COPY.invest.alertRemove}
                    >
                      <Feather name="x" size={20} color={color.text.tertiary} />
                    </Pressable>
                  }
                >
                  <RowTitle>{alert.symbol}</RowTitle>
                  <RowSubtitle>
                    {alert.firedAt === null
                      ? `${alertLine(alert)} · ${COPY.invest.alertWaiting}`
                      : `${alertLine(alert)} · ${fillTemplate(COPY.invest.alertFired, { price: vnd(alert.firedPrice ?? alert.price) })}`}
                  </RowSubtitle>
                </Row>
              ))}
            </Card>
          </View>
        ) : null}

        <Card>
          <View style={styles.cardBody} testID="invest-calc">
            <View style={styles.scoreHead}>
              <Text style={styles.title}>{COPY.invest.calcTitle}</Text>
              {ready ? (
                <Pressable
                  testID="invest-use-prices"
                  onPress={usePrices}
                  accessibilityRole="button"
                  accessibilityLabel={COPY.invest.useQuote}
                  style={({ pressed }) => [styles.link, pressed ? { opacity: 0.6 } : null]}
                >
                  <Feather name="download" size={14} color={color.primary.default} />
                  <Text style={styles.linkText}>{COPY.invest.useQuote}</Text>
                </Pressable>
              ) : null}
            </View>
            <TextField
              testID="invest-capital"
              label={COPY.invest.capital}
              value={capital}
              onChangeText={(text) => setCapital(groupDigits(text))}
              keyboardType="number-pad"
            />
            <View style={styles.pair}>
              <View style={styles.half}>
                <TextField
                  testID="invest-entry"
                  label={COPY.invest.entry}
                  value={entry}
                  onChangeText={(text) => setEntry(groupDigits(text))}
                  keyboardType="number-pad"
                  placeholder={
                    ready ? groupDigits(String(Math.round(ready.quote.close))) : undefined
                  }
                />
              </View>
              <View style={styles.half}>
                <TextField
                  testID="invest-stop"
                  label={COPY.invest.stop}
                  value={stop}
                  onChangeText={(text) => setStop(groupDigits(text))}
                  keyboardType="number-pad"
                  placeholder={
                    ready?.signal && ready.signal.suggestedStop !== null
                      ? groupDigits(String(Math.round(ready.signal.suggestedStop)))
                      : undefined
                  }
                  {...(calcError === undefined ? {} : { error: calcError })}
                />
              </View>
            </View>
            <Button
              testID="invest-calculate"
              label={COPY.invest.calculate}
              onPress={() => void calculate()}
              busy={sizing}
              fullWidth
              {...(offline ? { disabledReason: COPY.invest.offline } : {})}
            />
            {sizeFailed ? <FormBanner message={COPY.invest.unavailable} /> : null}
            {size !== null ? (
              <View testID="invest-result" style={styles.result}>
                {size.shares === 0 ? (
                  <Text style={styles.body}>{size.message ?? COPY.invest.resultNone}</Text>
                ) : (
                  <>
                    <Text style={styles.resultBig}>
                      {fillTemplate(COPY.invest.result, { shares: size.shares, lots: size.lots })}
                    </Text>
                    <View style={styles.statRow}>
                      <Text style={styles.caption}>{COPY.invest.resultCostLabel}</Text>
                      <Text style={styles.statValue}>{vnd(size.cost)}</Text>
                    </View>
                    <View style={styles.statRow}>
                      <Text style={styles.caption}>{COPY.invest.resultLossLabel}</Text>
                      <Text style={[styles.statValue, { color: color.danger.default }]}>
                        {`${vnd(size.maxLoss)} (${formatShare(size.maxLossPct)})`}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            ) : null}
          </View>
        </Card>

        <Card>
          <Row
            testID="invest-portfolio"
            leading={<IconBadge name="briefcase" />}
            chevron
            lastInGroup
            onPress={() => router.push('/(app)/portfolio')}
            accessibilityLabel={`${COPY.portfolio.title}. ${portfolioSubtitle}`}
          >
            <RowTitle>{COPY.portfolio.title}</RowTitle>
            <RowSubtitle>{portfolioSubtitle}</RowSubtitle>
          </Row>
        </Card>

        <Text style={styles.disclaimer}>{COPY.invest.disclaimer}</Text>
      </ScrollView>

      <AlertSheet
        visible={alertOpen}
        onClose={() => setAlertOpen(false)}
        symbol={ready?.quote.symbol ?? ''}
        close={ready?.quote.close ?? null}
        onSave={saveAlert}
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    content: { flexGrow: 1, gap: space[4], paddingTop: space[2] },
    block: { paddingHorizontal: space[4] },
    watch: { gap: space[2] },
    alerts: { gap: space[2] },
    sectionTitle: { ...type.subhead, color: color.text.secondary },
    chips: { gap: space[2], paddingHorizontal: space[4] },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      paddingVertical: space[1] + 2,
      paddingLeft: space[1] + 2,
      paddingRight: space[3],
      borderRadius: radius.pill,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.hairline,
    },
    chipActive: { backgroundColor: color.primary.subtle, borderColor: color.primary.default },
    chipText: { ...type.subhead, color: color.text.primary, letterSpacing: 0.3 },
    cardBody: { padding: space[5], gap: space[3] },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    heroName: { flex: 1 },
    symbol: { ...type.headline, color: color.text.primary, letterSpacing: 0.4 },
    star: { padding: space[1] },
    priceRow: { flexDirection: 'row', alignItems: 'baseline' },
    price: { ...type.amountHero, fontVariant: ['tabular-nums'], color: color.text.primary },
    moveRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[1] },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.border.hairline },
    title: { ...type.headline, color: color.text.primary },
    scoreHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    tonePill: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill },
    toneText: { ...type.subhead },
    scoreLine: { marginTop: -space[1] },
    scoreNumber: { ...type.display, fontVariant: ['tabular-nums'], color: color.text.primary },
    bullet: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    bulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.text.tertiary },
    stopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      padding: space[3],
      borderRadius: radius.md,
      backgroundColor: color.bg.sunken,
    },
    link: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
    linkText: { ...type.subhead, color: color.primary.default },
    pair: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
    half: { flex: 1 },
    result: {
      gap: space[2],
      padding: space[4],
      borderRadius: radius.md,
      backgroundColor: color.primary.subtle,
    },
    resultBig: { ...type.title1, color: color.text.primary },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    statValue: { ...type.bodyStrong, color: color.text.primary, fontVariant: ['tabular-nums'] },
    body: { ...type.body, color: color.text.primary, flexShrink: 1 },
    caption: { ...type.callout, color: color.text.secondary },
    disclaimer: {
      ...type.footnote,
      color: color.text.tertiary,
      textAlign: 'center',
      paddingHorizontal: space[6],
    },
  }),
);
