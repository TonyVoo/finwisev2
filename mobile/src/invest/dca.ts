import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { type CalendarDate, dateParts } from '../lib/calendar';
import { uuidv7 } from '../lib/uuidv7';
import { cleanSymbol } from './investModel';

/**
 * Monthly buying plans: "put 5.000.000 into VNM on the 5th of every month". A short list kept on the phone with the
 * other device settings; nothing is synced. A plan does not buy anything - it reminds the person on the day, suggests
 * how many shares the amount buys at the last price, and offers to record the buy.
 *
 * The day is 1 to 28 so every month has it.
 */

export const MAX_PLANS = 12;
export const MIN_DAY = 1;
export const MAX_DAY = 28;
/** Vietnamese exchanges trade in lots of 100. */
export const LOT = 100;
/** A typical brokerage fee, `0.15%`, so the suggestion does not spend more than the plan says. */
export const FEE_RATE = 0.0015;

export interface DcaPlan {
  readonly id: string;
  readonly symbol: string;
  /** Dong a month. */
  readonly amount: number;
  readonly day: number;
}

function isPlan(value: unknown): value is DcaPlan {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    cleanSymbol(String(v['symbol'])) === v['symbol'] &&
    Number.isInteger(v['amount']) &&
    (v['amount'] as number) >= 1 &&
    Number.isInteger(v['day']) &&
    (v['day'] as number) >= MIN_DAY &&
    (v['day'] as number) <= MAX_DAY
  );
}

export async function readPlans(database: SqliteDatabase): Promise<readonly DcaPlan[]> {
  const raw = await readMeta(database, META_KEYS.dcaPlans);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlan).slice(0, MAX_PLANS) : [];
  } catch {
    return [];
  }
}

async function write(database: SqliteDatabase, list: readonly DcaPlan[]): Promise<void> {
  await writeMeta(database, META_KEYS.dcaPlans, JSON.stringify(list));
}

export interface PlanInput {
  readonly symbol: string;
  readonly amount: number;
  readonly day: number;
}

/**
 * Save a plan. One plan per symbol: saving again replaces it, keeping its place in the list when it is being edited.
 * Anything that is not a ticker, a whole amount of dong or a day from 1 to 28 is ignored. Returns the new list.
 */
export async function savePlan(
  database: SqliteDatabase,
  input: PlanInput,
  editingId: string | null = null,
): Promise<readonly DcaPlan[]> {
  const symbol = cleanSymbol(input.symbol);
  const current = await readPlans(database);
  if (
    symbol === null ||
    !Number.isInteger(input.amount) ||
    input.amount < 1 ||
    input.amount > 1_000_000_000_000 ||
    !Number.isInteger(input.day) ||
    input.day < MIN_DAY ||
    input.day > MAX_DAY
  ) {
    return current;
  }
  const keepId = editingId ?? current.find((plan) => plan.symbol === symbol)?.id ?? uuidv7();
  const plan: DcaPlan = { id: keepId, symbol, amount: input.amount, day: input.day };
  const without = current.filter((p) => p.id !== keepId && p.symbol !== symbol);
  const index = current.findIndex((p) => p.id === keepId);
  const next =
    index >= 0 && index <= without.length
      ? [...without.slice(0, index), plan, ...without.slice(index)]
      : [plan, ...without];
  const capped = next.slice(0, MAX_PLANS);
  await write(database, capped);
  return capped;
}

export async function removePlan(
  database: SqliteDatabase,
  id: string,
): Promise<readonly DcaPlan[]> {
  const next = (await readPlans(database)).filter((plan) => plan.id !== id);
  await write(database, next);
  return next;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The plan's day in a month, as a date. */
function inMonth(year: number, month: number, day: number): CalendarDate {
  const wrapped = new Date(Date.UTC(year, month - 1, 1));
  return `${wrapped.getUTCFullYear()}-${pad(wrapped.getUTCMonth() + 1)}-${pad(day)}`;
}

/** The next day the plan falls on, today included: this month's day if it has not passed, otherwise next month's. */
export function nextBuyDate(plan: Pick<DcaPlan, 'day'>, today: CalendarDate): CalendarDate {
  const { year, month, day } = dateParts(today);
  return day <= plan.day ? inMonth(year, month, plan.day) : inMonth(year, month + 1, plan.day);
}

/** The next `count` days the plan falls on, from `today`. */
export function upcomingBuyDates(
  plan: Pick<DcaPlan, 'day'>,
  today: CalendarDate,
  count: number,
): readonly CalendarDate[] {
  const first = nextBuyDate(plan, today);
  const { year, month } = dateParts(first);
  return Array.from({ length: count }, (_, i) => inMonth(year, month + i, plan.day));
}

export interface Lots {
  readonly shares: number;
  /** What those shares cost with the fee. */
  readonly cost: number;
  /** What the amount leaves over. */
  readonly leftover: number;
}

/** How many whole lots of 100 the amount buys at `price`, fee included; zero shares when it buys none. */
export function lotsFor(amount: number, price: number, feeRate: number = FEE_RATE): Lots {
  if (!(price > 0) || !(amount > 0)) return { shares: 0, cost: 0, leftover: Math.max(0, amount) };
  const perLot = LOT * price * (1 + feeRate);
  const lots = Math.floor(amount / perLot);
  const shares = lots * LOT;
  const cost = Math.round(shares * price * (1 + feeRate));
  return { shares, cost, leftover: amount - cost };
}
