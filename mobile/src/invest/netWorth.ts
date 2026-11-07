import type { MarketQuotePoint } from '@expense-tracker/shared';
import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import { listLiveGoals } from '../db/queries';
import { readUserCurrency } from '../db/user';
import type { SqliteDatabase } from '../db/sqlite';
import type { TradeListItem } from '../db/queries';

/**
 * Net worth over time: what the stocks were worth on each trading day (rebuilt from the trades and the closing
 * prices, so it has real history), plus the savings held in goals (which only has history from when it began to be
 * recorded, one snapshot a day).
 *
 * The series starts where both parts are known, never earlier: a stretch with the savings missing would show as a
 * jump the person never had. Pure and integer-only; the caller supplies the trades, prices and snapshots.
 */

export interface Snapshot {
  readonly date: string;
  readonly savingsMinor: number;
}

export const MAX_SNAPSHOTS = 800;

/** Shares held of each symbol at the end of `date`: buys add, sells take away, dividends change nothing. */
export function sharesAsOf(trades: readonly TradeListItem[], date: string): Map<string, number> {
  const held = new Map<string, number>();
  for (const trade of trades) {
    if (trade.date > date || trade.side === 'dividend') continue;
    const delta = trade.side === 'buy' ? trade.quantity : -trade.quantity;
    held.set(trade.symbol, (held.get(trade.symbol) ?? 0) + delta);
  }
  for (const [symbol, quantity] of held) if (quantity <= 0) held.delete(symbol);
  return held;
}

/** The last close on or before `date`, or null before the first one. `series` is oldest first. */
export function closeAsOf(series: readonly MarketQuotePoint[], date: string): number | null {
  let lo = 0;
  let hi = series.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = series[mid] as MarketQuotePoint;
    if (point.date <= date) {
      found = point.close;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The savings as last recorded on or before `date`, or null before the first snapshot. `snapshots` is oldest first. */
export function savingsAsOf(snapshots: readonly Snapshot[], date: string): number | null {
  let found: number | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.date <= date) found = snapshot.savingsMinor;
    else break;
  }
  return found;
}

/** What the shares held on `date` were worth, or null if any of them has no price yet. */
export function stocksValueAt(
  trades: readonly TradeListItem[],
  series: Readonly<Record<string, readonly MarketQuotePoint[]>>,
  date: string,
): number | null {
  let total = 0;
  for (const [symbol, quantity] of sharesAsOf(trades, date)) {
    const close = closeAsOf(series[symbol] ?? [], date);
    if (close === null) return null;
    total += quantity * close;
  }
  return Math.round(total);
}

export interface NetWorthSeries {
  /** One point per trading day, `close` being the net worth in dong; the shape the price chart draws. */
  readonly points: readonly MarketQuotePoint[];
  /** When the savings began to be counted, or null when none is held (so the series is the stocks alone). */
  readonly savingsFrom: string | null;
}

export function buildNetWorthSeries(input: {
  readonly trades: readonly TradeListItem[];
  readonly series: Readonly<Record<string, readonly MarketQuotePoint[]>>;
  readonly snapshots: readonly Snapshot[];
}): NetWorthSeries {
  const { trades, series, snapshots } = input;
  const firstSaved = snapshots.find((s) => s.savingsMinor > 0) ?? null;
  const savingsFrom = firstSaved?.date ?? null;
  const firstTrade = trades.map((t) => t.date).sort()[0] ?? null;

  // Trading days, from every price series that is needed; with no stocks, the days the savings were recorded.
  const days = new Set<string>();
  for (const trade of trades) for (const p of series[trade.symbol] ?? []) days.add(p.date);
  if (firstTrade === null) for (const s of snapshots) days.add(s.date);

  const from =
    [firstTrade, savingsFrom]
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;
  if (from === null) return { points: [], savingsFrom };

  const points: MarketQuotePoint[] = [];
  for (const date of [...days].sort()) {
    if (date < from) continue;
    const stocks = stocksValueAt(trades, series, date);
    if (stocks === null) continue;
    points.push({ date, close: stocks + (savingsAsOf(snapshots, date) ?? 0), volume: 0 });
  }
  return { points, savingsFrom };
}

export async function readSnapshots(database: SqliteDatabase): Promise<readonly Snapshot[]> {
  const raw = await readMeta(database, META_KEYS.netWorthSnapshots);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is Snapshot =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as Snapshot).date === 'string' &&
          Number.isSafeInteger((s as Snapshot).savingsMinor),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_SNAPSHOTS);
  } catch {
    return [];
  }
}

/** Record the savings as of `today`: one a day, the day's last reading winning. Returns the list. */
export async function recordSnapshot(
  database: SqliteDatabase,
  today: string,
  savingsMinor: number,
): Promise<readonly Snapshot[]> {
  const current = await readSnapshots(database);
  const last = current.at(-1);
  if (last !== undefined && last.date === today && last.savingsMinor === savingsMinor)
    return current;
  const next = [...current.filter((s) => s.date !== today), { date: today, savingsMinor }].slice(
    -MAX_SNAPSHOTS,
  );
  await writeMeta(database, META_KEYS.netWorthSnapshots, JSON.stringify(next));
  return next;
}

/** Look at the goals now and record their total, for an account in dong (the only one the net worth is drawn for). */
export async function recordSavingsNow(database: SqliteDatabase, today: string): Promise<void> {
  if ((await readUserCurrency(database)) !== 'VND') return;
  const goals = await listLiveGoals(database);
  const savings = goals
    .filter((g) => g.currency === 'VND')
    .reduce((sum, g) => sum + g.savedMinor, 0);
  await recordSnapshot(database, today, savings);
}
