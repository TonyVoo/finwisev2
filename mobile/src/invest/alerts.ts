import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { uuidv7 } from '../lib/uuidv7';
import { cleanSymbol } from './investModel';

/**
 * Price alerts: "tell me when VNM goes above 60.000 or below 52.000". A short list kept on the phone, with the other
 * device settings (it survives a household switch); nothing is synced and no price is stored beyond the one that
 * tripped the alert.
 *
 * An alert fires **once** and then stays in the list, marked with when and at what price, until the person removes it
 * or sets it again: a price that hovers around the line must not buzz the phone every few minutes.
 */

export const MAX_ALERTS = 20;

export type AlertDirection = 'above' | 'below';

export interface PriceAlert {
  readonly id: string;
  readonly symbol: string;
  readonly direction: AlertDirection;
  /** Dong per share. */
  readonly price: number;
  /** When it fired (ISO), or null while it is still waiting. */
  readonly firedAt: string | null;
  /** The close that tripped it, once it has. */
  readonly firedPrice: number | null;
}

function isAlert(value: unknown): value is PriceAlert {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    cleanSymbol(String(v['symbol'])) === v['symbol'] &&
    (v['direction'] === 'above' || v['direction'] === 'below') &&
    typeof v['price'] === 'number' &&
    Number.isInteger(v['price']) &&
    v['price'] > 0 &&
    (v['firedAt'] === null || typeof v['firedAt'] === 'string') &&
    (v['firedPrice'] === null || typeof v['firedPrice'] === 'number')
  );
}

export async function readAlerts(database: SqliteDatabase): Promise<readonly PriceAlert[]> {
  const raw = await readMeta(database, META_KEYS.priceAlerts);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAlert).slice(0, MAX_ALERTS) : [];
  } catch {
    return [];
  }
}

async function write(database: SqliteDatabase, list: readonly PriceAlert[]): Promise<void> {
  await writeMeta(database, META_KEYS.priceAlerts, JSON.stringify(list));
}

/**
 * Add an alert. The same symbol and direction replaces the old one (one line per side), and a price that is not a
 * whole number of dong above zero is ignored. Newest first; the oldest beyond twenty go. Returns the new list.
 */
export async function addAlert(
  database: SqliteDatabase,
  symbolText: string,
  direction: AlertDirection,
  price: number,
): Promise<readonly PriceAlert[]> {
  const symbol = cleanSymbol(symbolText);
  const current = await readAlerts(database);
  if (symbol === null || !Number.isInteger(price) || price < 1 || price > 1_000_000_000)
    return current;
  const next = [
    { id: uuidv7(), symbol, direction, price, firedAt: null, firedPrice: null },
    ...current.filter((alert) => !(alert.symbol === symbol && alert.direction === direction)),
  ].slice(0, MAX_ALERTS);
  await write(database, next);
  return next;
}

export async function removeAlert(
  database: SqliteDatabase,
  id: string,
): Promise<readonly PriceAlert[]> {
  const next = (await readAlerts(database)).filter((alert) => alert.id !== id);
  await write(database, next);
  return next;
}

/** Whether a close has reached an alert: at or past the price, in the alert's direction. */
export function isTripped(alert: PriceAlert, close: number): boolean {
  return alert.direction === 'above' ? close >= alert.price : close <= alert.price;
}

/**
 * The waiting alerts a set of closes has tripped. A symbol with no price (`null`, or not asked for) trips nothing:
 * not knowing the price is not the price falling.
 */
export function trippedBy(
  alerts: readonly PriceAlert[],
  closes: Readonly<Record<string, number | null>>,
): readonly PriceAlert[] {
  return alerts.filter((alert) => {
    if (alert.firedAt !== null) return false;
    const close = closes[alert.symbol];
    return close !== null && close !== undefined && isTripped(alert, close);
  });
}

/** The alerts still waiting, and the symbols to ask a price for. */
export function waitingSymbols(alerts: readonly PriceAlert[]): readonly string[] {
  return [...new Set(alerts.filter((alert) => alert.firedAt === null).map((a) => a.symbol))];
}

/** Mark alerts as fired at `now`, at the close that tripped them. */
export async function markFired(
  database: SqliteDatabase,
  fired: ReadonlyArray<{ readonly id: string; readonly close: number }>,
  now: Date,
): Promise<readonly PriceAlert[]> {
  const byId = new Map(fired.map((f) => [f.id, f.close]));
  const next = (await readAlerts(database)).map((alert) =>
    byId.has(alert.id) && alert.firedAt === null
      ? { ...alert, firedAt: now.toISOString(), firedPrice: byId.get(alert.id) ?? null }
      : alert,
  );
  await write(database, next);
  return next;
}

/** A fired alert goes back to waiting, for "set it again" without retyping the price. */
export async function rearm(database: SqliteDatabase, id: string): Promise<readonly PriceAlert[]> {
  const next = (await readAlerts(database)).map((alert) =>
    alert.id === id ? { ...alert, firedAt: null, firedPrice: null } : alert,
  );
  await write(database, next);
  return next;
}
