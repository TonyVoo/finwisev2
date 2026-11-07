import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Card, SectionTitle } from '@/components/Card';
import { AppBar, Fab, IconButton, PendingGlyph } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { EmptyIcon } from '@/components/EmptyIcon';
import { FadeInUp } from '@/components/FadeInUp';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { useSnackbar } from '@/components/Snackbar';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { COPY } from '@/copy/strings';
import { useTrades } from '@/db/hooks';
import { useLocalWrite } from '@/db/localWrite';
import { type NewTrade, createTrade, deleteTrade, updateTrade } from '@/db/mutations';
import type { TradeListItem } from '@/db/queries';
import { useDatabase } from '@/db/DatabaseProvider';
import { AllocationBar } from '@/invest/AllocationBar';
import { ChangePill } from '@/invest/ChangePill';
import {
  fillTemplate,
  formatDong as vnd,
  formatSignedDong as signed,
  formatShare,
  groupDigits,
} from '@/invest/investModel';
import {
  buildPortfolio,
  performanceOf,
  resultsByTag,
  summarise,
  valuePosition,
} from '@/invest/portfolioModel';
import { SymbolAvatar } from '@/invest/SymbolAvatar';
import { type DcaPlan, nextBuyDate, readPlans, removePlan, savePlan } from '@/invest/dca';
import { syncDcaReminders } from '@/invest/dcaReminders';
import { DcaPlanSheet } from '@/invest/DcaPlanSheet';
import { ImportTradesSheet } from '@/invest/ImportTradesSheet';
import { sideLabel, TradeFormSheet } from '@/invest/TradeFormSheet';
import type { TradeDraft } from '@/invest/tradeModel';
import { usePortfolioQuotes } from '@/invest/usePortfolioQuotes';
import { readWatchlist } from '@/invest/watchlist';
import { savedHaptic, warnHaptic } from '@/lib/haptics';
import { dateRowLabel } from '@/lib/calendar';
import { useSelectedMonth } from '@/month/MonthProvider';
import { goBack } from '@/navigation/goBack';
import { useOptionalSyncStatus } from '@/sync/SyncProvider';
import { createStyles, useColors } from '@/theme/ThemeProvider';
import { radius, size, space, type } from '@/theme/tokens';

export const PORTFOLIO_ROW_PREFIX = 'portfolio-position';
export const TRADE_ROW_PREFIX = 'portfolio-trade';

/** What a trade moved in dong: shares at the price, plus the fee on a buy and less it on a sell. */
function tradeValue(trade: TradeListItem): number {
  const gross = trade.quantity * trade.price;
  // A buy costs its fee on top; a sale and a dividend lose it from what comes in.
  return trade.side === 'buy' ? gross + trade.fee : gross - trade.fee;
}

/** Trades grouped by the day they were made, newest day first. */
function byDay(
  trades: readonly TradeListItem[],
): ReadonlyArray<readonly [string, TradeListItem[]]> {
  const days = new Map<string, TradeListItem[]>();
  for (const trade of [...trades].reverse()) {
    const list = days.get(trade.date) ?? [];
    list.push(trade);
    days.set(trade.date, list);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/**
 * The portfolio: the trades the person entered, the holdings and profit worked out from them, and the
 * last close of each holding. Trades are private to the person (even in a household) and sync like any
 * other row; the holdings are derived on the device, so nothing here can disagree between two devices.
 */
export default function PortfolioScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const database = useDatabase();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const { today } = useSelectedMonth();
  const status = useOptionalSyncStatus();
  const offline = status !== null && !status.reachable;

  const trades = useTrades();
  const rows = trades.data ?? [];
  const book = useMemo(() => buildPortfolio(rows), [rows]);
  const [plans, setPlans] = useState<readonly DcaPlan[]>([]);
  const [planSymbol, setPlanSymbol] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readPlans(database).then((list) => {
      if (!cancelled) setPlans(list);
    });
    return () => {
      cancelled = true;
    };
  }, [database]);
  // The holdings need a price to be valued, and the plans one to say what their amount buys.
  const symbols = useMemo(
    () => [
      ...new Set([
        ...book.open.map((position) => position.symbol),
        ...plans.map((p) => p.symbol),
        ...(planSymbol === null ? [] : [planSymbol]),
      ]),
    ],
    [book, plans, planSymbol],
  );
  const quotes = usePortfolioQuotes(api, symbols, !offline);
  const totals = summarise(book, quotes.closes);

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

  const [editing, setEditing] = useState<TradeListItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planEditing, setPlanEditing] = useState<DcaPlan | null>(null);
  const [draft, setDraft] = useState<Partial<TradeDraft> | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<TradeListItem | null>(null);

  const submit = useCallback(
    async (value: NewTrade) => {
      await localWrite(async (db) => {
        if (editing === null) await createTrade(db, value);
        else await updateTrade(db, editing.id, { ...value, note: value.note ?? null });
      });
      setSheetOpen(false);
      showSnackbar({ message: COPY.portfolio.saved });
    },
    [editing, localWrite, showSnackbar],
  );

  const runImport = useCallback(
    async (list: readonly NewTrade[]) => {
      await localWrite(async (db) => {
        for (const trade of list) await createTrade(db, trade);
      });
      setImportOpen(false);
      savedHaptic();
      showSnackbar({ message: fillTemplate(COPY.portfolio.importDone, { count: list.length }) });
    },
    [localWrite, showSnackbar],
  );

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    const target = pendingDelete;
    setPendingDelete(null);
    await localWrite((db) => deleteTrade(db, target.id));
    warnHaptic();
    showSnackbar({ message: COPY.portfolio.deleted });
  }, [pendingDelete, localWrite, showSnackbar]);

  const hasPrices = Object.values(quotes.closes).some((close) => close !== null);
  const days = useMemo(() => byDay(rows), [rows]);
  const performance = useMemo(() => performanceOf(book.sales), [book]);
  const reasons = useMemo(() => resultsByTag(book.sales), [book]);
  const oversold = book.open.concat(book.closed).filter((position) => position.oversold > 0);
  const held = useMemo(
    () => Object.fromEntries(book.open.map((position) => [position.symbol, position.quantity])),
    [book],
  );
  const suggestions = useMemo(
    () => [...new Set([...book.open.map((p) => p.symbol), ...watched])],
    [book, watched],
  );

  const openAdd = () => {
    setEditing(null);
    setDraft(undefined);
    setSheetOpen(true);
  };

  const savePlanFromSheet = async (
    input: { symbol: string; amount: number; day: number },
    editingId: string | null,
  ) => {
    setPlans(await savePlan(database, input, editingId));
    setPlanOpen(false);
    showSnackbar({ message: COPY.portfolio.dcaSaved });
    void syncDcaReminders(database).catch(() => undefined);
  };

  const deletePlan = async () => {
    if (planEditing === null) return;
    setPlans(await removePlan(database, planEditing.id));
    setPlanOpen(false);
    showSnackbar({ message: COPY.portfolio.dcaRemoved });
    void syncDcaReminders(database).catch(() => undefined);
  };

  /** This month's buy, opened as a trade with the shares and price the plan suggests. */
  const recordPlan = (plan: DcaPlan, shares: number, price: number | null) => {
    setPlanOpen(false);
    setEditing(null);
    setDraft({
      symbolText: plan.symbol,
      ...(shares > 0 ? { quantityText: groupDigits(String(shares)) } : {}),
      ...(price === null ? {} : { priceText: groupDigits(String(Math.round(price))) }),
    });
    setSheetOpen(true);
  };

  const plansSection = (
    <>
      <View style={styles.planHead}>
        <SectionTitle>{COPY.portfolio.dcaTitle}</SectionTitle>
        <Pressable
          testID="portfolio-plan-add"
          onPress={() => {
            setPlanEditing(null);
            setPlanOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={COPY.portfolio.dcaAdd}
          hitSlop={10}
        >
          <Text style={styles.link}>{COPY.portfolio.dcaAdd}</Text>
        </Pressable>
      </View>
      {plans.length === 0 ? (
        <Text style={styles.planHint}>{COPY.portfolio.dcaEmptyHint}</Text>
      ) : (
        <Card>
          {plans.map((plan, index) => (
            <Row
              key={plan.id}
              testID={`portfolio-plan-${plan.symbol}`}
              leading={<SymbolAvatar symbol={plan.symbol} />}
              chevron
              lastInGroup={index === plans.length - 1}
              onPress={() => {
                setPlanEditing(plan);
                setPlanOpen(true);
              }}
              accessibilityLabel={`${plan.symbol}, ${fillTemplate(COPY.portfolio.dcaLine, { amount: vnd(plan.amount), day: plan.day })}`}
            >
              <RowTitle>{plan.symbol}</RowTitle>
              <RowSubtitle lines={2}>
                {`${fillTemplate(COPY.portfolio.dcaLine, { amount: vnd(plan.amount), day: plan.day })}\n${fillTemplate(COPY.portfolio.dcaNext, { date: dateRowLabel(nextBuyDate(plan, today), today) })}`}
              </RowSubtitle>
            </Row>
          ))}
        </Card>
      )}
    </>
  );

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.portfolio.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => goBack(router, '/(app)/(tabs)/invest')}
            tint={color.text.primary}
            testID="portfolio-back"
          />
        }
        trailing={
          <IconButton
            icon="upload"
            label={COPY.portfolio.importTitle}
            onPress={() => setImportOpen(true)}
            tint={color.text.primary}
            testID="portfolio-import"
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={quotes.refresh}
            tintColor={color.text.tertiary}
          />
        }
      >
        {rows.length === 0 ? (
          !trades.isPending ? (
            <View style={styles.empty} testID="portfolio-empty">
              <EmptyIcon name="trending-up" />
              <Text style={styles.emptyHeadline} accessibilityRole="header">
                {COPY.portfolio.emptyHeadline}
              </Text>
              <Text style={styles.emptyBody}>{COPY.portfolio.emptyBody}</Text>
              {plansSection}
            </View>
          ) : null
        ) : (
          <>
            <FadeInUp>
              <Card>
                <View style={styles.hero} testID="portfolio-summary">
                  <Text style={styles.label}>{COPY.portfolio.marketValue}</Text>
                  <Text style={styles.big} accessibilityRole="header">
                    {vnd(totals.worth)}
                  </Text>
                  {hasPrices ? (
                    <View style={styles.moveRow}>
                      <ChangePill
                        fraction={totals.unrealizedPct}
                        testID="portfolio-unrealized-pill"
                      />
                      <Text
                        testID="portfolio-unrealized"
                        style={[styles.move, totals.unrealized < 0 ? styles.down : styles.up]}
                      >
                        {signed(totals.unrealized)}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.divider} />
                  <View style={styles.metrics}>
                    <View style={styles.metric}>
                      <Text style={styles.caption}>{COPY.portfolio.cost}</Text>
                      <Text style={styles.value}>{vnd(totals.cost)}</Text>
                    </View>
                    <View style={styles.metric}>
                      <Text style={styles.caption}>{COPY.portfolio.realized}</Text>
                      <Text
                        testID="portfolio-realized"
                        style={[
                          styles.value,
                          totals.realized < 0
                            ? styles.down
                            : totals.realized > 0
                              ? styles.up
                              : null,
                        ]}
                      >
                        {signed(totals.realized)}
                      </Text>
                    </View>
                    {totals.dividends > 0 ? (
                      <View style={styles.metric}>
                        <Text style={styles.caption}>{COPY.portfolio.dividends}</Text>
                        <Text testID="portfolio-dividends" style={[styles.value, styles.up]}>
                          {signed(totals.dividends)}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {book.open.length > 1 ? (
                    <>
                      <View style={styles.divider} />
                      <Text style={styles.caption}>{COPY.portfolio.allocation}</Text>
                      <AllocationBar positions={book.open} />
                    </>
                  ) : null}

                  {quotes.status === 'done' && !hasPrices && book.open.length > 0 ? (
                    <Notice icon="cloud-off" text={COPY.portfolio.pricesUnavailable} />
                  ) : hasPrices && totals.unpriced > 0 ? (
                    <Notice
                      testID="portfolio-unpriced"
                      icon="info"
                      text={
                        totals.unpriced === 1
                          ? COPY.portfolio.unpricedOne
                          : fillTemplate(COPY.portfolio.unpricedMany, { count: totals.unpriced })
                      }
                    />
                  ) : null}
                </View>
              </Card>
            </FadeInUp>

            {book.open.length > 0 ? (
              <>
                <SectionTitle>{COPY.portfolio.holdings}</SectionTitle>
                <FadeInUp delay={60}>
                  <Card>
                    {book.open.map((position, index) => {
                      const valuation = valuePosition(
                        position,
                        quotes.closes[position.symbol] ?? null,
                      );
                      const shares = fillTemplate(COPY.portfolio.sharesCount, {
                        quantity: groupDigits(String(position.quantity)),
                      });
                      const average = fillTemplate(COPY.portfolio.avgCost, {
                        avg: vnd(position.avgCost),
                      });
                      return (
                        <Row
                          key={position.symbol}
                          testID={`${PORTFOLIO_ROW_PREFIX}-${position.symbol}`}
                          leading={<SymbolAvatar symbol={position.symbol} />}
                          lastInGroup={index === book.open.length - 1}
                          accessibilityLabel={`${position.symbol}, ${shares}, ${average}`}
                          trailing={
                            valuation === null ? null : (
                              <View style={styles.trailing}>
                                <Text style={styles.value}>{vnd(valuation.marketValue)}</Text>
                                <ChangePill fraction={valuation.unrealizedPct} size="small" />
                              </View>
                            )
                          }
                        >
                          <RowTitle>{position.symbol}</RowTitle>
                          <RowSubtitle lines={2}>{`${shares}\n${average}`}</RowSubtitle>
                        </Row>
                      );
                    })}
                  </Card>
                </FadeInUp>
              </>
            ) : null}

            {plansSection}

            {oversold.map((position) => (
              <View key={position.symbol} style={styles.warning}>
                <Feather name="alert-triangle" size={14} color={color.warning.default} />
                <Text style={styles.warningText}>
                  {`${position.symbol}: ${fillTemplate(COPY.portfolio.oversold, {
                    count: position.oversold,
                  })}`}
                </Text>
              </View>
            ))}

            {performance.sales > 0 ? (
              <>
                <SectionTitle>{COPY.portfolio.perfTitle}</SectionTitle>
                <FadeInUp delay={90}>
                  <Card>
                    <View style={styles.hero} testID="portfolio-performance">
                      <View style={styles.perfHead}>
                        <View>
                          <Text style={styles.label}>{COPY.portfolio.winRate}</Text>
                          <Text style={styles.big} testID="portfolio-winrate">
                            {performance.winRate === null ? '—' : formatShare(performance.winRate)}
                          </Text>
                        </View>
                        <Text style={styles.caption}>
                          {fillTemplate(COPY.portfolio.winsLosses, {
                            wins: performance.wins,
                            losses: performance.losses,
                          })}
                        </Text>
                      </View>
                      <WinLossBar wins={performance.wins} losses={performance.losses} />
                      <View style={styles.divider} />
                      <View style={styles.metrics}>
                        <View style={styles.metric}>
                          <Text style={styles.caption}>{COPY.portfolio.avgWin}</Text>
                          <Text style={[styles.value, styles.up]}>
                            {signed(performance.avgWin)}
                          </Text>
                        </View>
                        <View style={styles.metric}>
                          <Text style={styles.caption}>{COPY.portfolio.avgLoss}</Text>
                          <Text
                            style={[styles.value, performance.avgLoss > 0 ? styles.down : null]}
                          >
                            {performance.avgLoss > 0 ? `-${vnd(performance.avgLoss)}` : vnd(0)}
                          </Text>
                        </View>
                        <View style={styles.metric}>
                          <Text style={styles.caption}>{COPY.portfolio.profitFactor}</Text>
                          <Text style={styles.value}>
                            {performance.profitFactor === null
                              ? '—'
                              : performance.profitFactor.toFixed(1)}
                          </Text>
                        </View>
                      </View>
                      {performance.best !== null ? (
                        <View style={styles.metrics}>
                          <View style={styles.metric}>
                            <Text style={styles.caption}>{COPY.portfolio.bestSale}</Text>
                            <Text style={[styles.value, styles.up]}>
                              {`${performance.best.symbol} ${signed(performance.best.realized)}`}
                            </Text>
                          </View>
                          {performance.worst !== null ? (
                            <View style={styles.metric}>
                              <Text style={styles.caption}>{COPY.portfolio.worstSale}</Text>
                              <Text
                                style={[
                                  styles.value,
                                  performance.worst.realized < 0 ? styles.down : null,
                                ]}
                              >
                                {`${performance.worst.symbol} ${signed(performance.worst.realized)}`}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                      <View style={styles.divider} />
                      <Text style={styles.caption}>{COPY.portfolio.byReason}</Text>
                      {reasons.length === 0 ? (
                        <Text style={styles.footerText}>{COPY.portfolio.reasonHint}</Text>
                      ) : (
                        reasons.slice(0, 5).map((reason) => (
                          <View
                            key={reason.tag}
                            style={styles.reasonRow}
                            testID={`portfolio-reason-${reason.tag}`}
                          >
                            <View style={styles.reasonName}>
                              <Text style={styles.value}>{`#${reason.tag}`}</Text>
                              <Text style={styles.footerText}>
                                {fillTemplate(COPY.portfolio.tagLine, {
                                  count: reason.sales,
                                  rate: formatShare(reason.winRate),
                                })}
                              </Text>
                            </View>
                            <Text
                              style={[styles.value, reason.total < 0 ? styles.down : styles.up]}
                            >
                              {signed(reason.total)}
                            </Text>
                          </View>
                        ))
                      )}
                    </View>
                  </Card>
                </FadeInUp>
              </>
            ) : null}

            <SectionTitle>{COPY.portfolio.history}</SectionTitle>
            {days.map(([day, list]) => (
              <View key={day} style={styles.day}>
                <Text style={styles.dayTitle}>{dateRowLabel(day, today)}</Text>
                <Card>
                  {list.map((trade, index) => {
                    const buy = trade.side === 'buy';
                    const dividend = trade.side === 'dividend';
                    const detail = fillTemplate(COPY.portfolio.tradeLine, {
                      side: sideLabel(trade.side),
                      quantity: groupDigits(String(trade.quantity)),
                      price: vnd(trade.price),
                    });
                    return (
                      <SwipeToDelete
                        key={trade.id}
                        onDelete={() => setPendingDelete(trade)}
                        actionLabel={COPY.common.delete}
                        testID={`trade-swipe-${trade.id}`}
                      >
                        <Row
                          testID={`${TRADE_ROW_PREFIX}-${trade.id}`}
                          onPress={() => {
                            setEditing(trade);
                            setSheetOpen(true);
                          }}
                          lastInGroup={index === list.length - 1}
                          accessibilityLabel={`${trade.symbol}, ${detail}, ${vnd(tradeValue(trade))}`}
                          accessibilityActions={[
                            {
                              name: 'delete',
                              label: COPY.a11y.deleteNamed.replace('{name}', trade.symbol),
                            },
                          ]}
                          onAccessibilityAction={(event) => {
                            if (event.nativeEvent.actionName === 'delete') setPendingDelete(trade);
                          }}
                          leading={
                            <View
                              style={[
                                styles.sideBadge,
                                {
                                  backgroundColor: dividend
                                    ? color.info.subtle
                                    : buy
                                      ? color.success.subtle
                                      : color.danger.subtle,
                                },
                              ]}
                            >
                              <Feather
                                name={
                                  dividend
                                    ? 'dollar-sign'
                                    : buy
                                      ? 'arrow-down-left'
                                      : 'arrow-up-right'
                                }
                                size={18}
                                color={
                                  dividend
                                    ? color.info.default
                                    : buy
                                      ? color.success.default
                                      : color.danger.default
                                }
                              />
                            </View>
                          }
                          trailing={
                            <View style={styles.trailing}>
                              <Text style={styles.value}>{vnd(tradeValue(trade))}</Text>
                              {trade.pending ? <PendingGlyph /> : null}
                            </View>
                          }
                        >
                          <RowTitle>{trade.symbol}</RowTitle>
                          <RowSubtitle>{detail}</RowSubtitle>
                        </Row>
                      </SwipeToDelete>
                    );
                  })}
                </Card>
              </View>
            ))}
          </>
        )}
        <View style={styles.footer}>
          <Feather name="lock" size={13} color={color.text.tertiary} />
          <Text style={styles.footerText}>{COPY.portfolio.private}</Text>
        </View>
      </ScrollView>

      <Fab label={COPY.portfolio.fab} onPress={openAdd} testID="portfolio-fab" />

      <TradeFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
        today={today}
        initialDraft={draft}
        suggestions={suggestions}
        held={held}
        onSubmit={async (value) => {
          await submit(value);
          savedHaptic();
        }}
        onDelete={
          editing === null
            ? undefined
            : () => {
                setSheetOpen(false);
                setPendingDelete(editing);
              }
        }
      />

      <DcaPlanSheet
        visible={planOpen}
        onClose={() => setPlanOpen(false)}
        editing={planEditing}
        closes={quotes.closes}
        onSymbolChange={setPlanSymbol}
        onSave={savePlanFromSheet}
        onRecord={recordPlan}
        onDelete={planEditing === null ? undefined : () => void deletePlan()}
      />

      <ImportTradesSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        existing={rows}
        onImport={runImport}
      />

      <Dialog
        visible={pendingDelete !== null}
        title={COPY.portfolio.deleteTitle}
        body={COPY.portfolio.deleteBody}
        destructive={{ label: COPY.common.delete, onPress: () => void confirmDelete() }}
        onCancel={() => setPendingDelete(null)}
        testID="portfolio-delete-dialog"
      />
    </View>
  );
}

/** Wins against losses as one bar, split in proportion: green and red, with nothing drawn for no sales. */
function WinLossBar({ wins, losses }: { readonly wins: number; readonly losses: number }) {
  const styles = useStyles();
  const color = useColors();
  if (wins + losses === 0) return null;
  return (
    <View
      style={styles.winLoss}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {wins > 0 ? <View style={{ flex: wins, backgroundColor: color.success.default }} /> : null}
      {losses > 0 ? <View style={{ flex: losses, backgroundColor: color.danger.default }} /> : null}
    </View>
  );
}

function Notice({
  icon,
  text,
  testID,
}: {
  readonly icon: 'cloud-off' | 'info';
  readonly text: string;
  readonly testID?: string;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <View style={styles.notice} testID={testID}>
      <Feather name={icon} size={14} color={color.text.secondary} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    content: {
      flexGrow: 1,
      gap: space[3],
      paddingTop: space[3],
      paddingBottom: size.fab + space[4] + space[4],
    },
    hero: { padding: space[5], gap: space[3] },
    label: { ...type.subhead, color: color.text.secondary },
    big: { ...type.amountHero, fontVariant: ['tabular-nums'], color: color.text.primary },
    moveRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[1] },
    move: { ...type.subhead, fontVariant: ['tabular-nums'] },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.border.hairline },
    metrics: { flexDirection: 'row', gap: space[4] },
    metric: { flex: 1, gap: 2 },
    caption: { ...type.callout, color: color.text.secondary },
    value: { ...type.bodyStrong, color: color.text.primary, fontVariant: ['tabular-nums'] },
    trailing: { alignItems: 'flex-end', gap: 4 },
    up: { color: color.success.default },
    down: { color: color.danger.default },
    perfHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    winLoss: {
      flexDirection: 'row',
      height: 8,
      borderRadius: radius.pill,
      overflow: 'hidden',
      gap: 2,
    },
    reasonRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    reasonName: { gap: 2, flex: 1 },
    planHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingRight: space[5],
    },
    planHint: { ...type.footnote, color: color.text.tertiary, paddingHorizontal: space[5] },
    link: { ...type.subhead, color: color.primary.default },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      padding: space[3],
      borderRadius: radius.md,
      backgroundColor: color.bg.sunken,
    },
    noticeText: { ...type.footnote, color: color.text.secondary, flex: 1 },
    warning: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      paddingHorizontal: space[4],
    },
    warningText: { ...type.footnote, color: color.warning.default, flex: 1 },
    day: { gap: space[2] },
    dayTitle: { ...type.subhead, color: color.text.secondary, paddingHorizontal: space[5] },
    sideBadge: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    empty: { padding: space[6], gap: space[2], alignItems: 'center' },
    emptyHeadline: { ...type.title1, color: color.text.primary, textAlign: 'center' },
    emptyBody: { ...type.body, color: color.text.secondary, textAlign: 'center' },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[1] + 2,
      paddingHorizontal: space[4],
      paddingTop: space[2],
    },
    footerText: { ...type.footnote, color: color.text.tertiary },
  }),
);
