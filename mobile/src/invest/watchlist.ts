import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { cleanSymbol } from './investModel';

/**
 * The stocks the person watches: a short list of tickers kept on the phone, with the account's other
 * device settings (it survives a household switch). Nothing is synced and no price is stored; a tap
 * on a symbol just looks it up again.
 */

export const MAX_WATCHED = 20;

export async function readWatchlist(database: SqliteDatabase): Promise<readonly string[]> {
  const raw = await readMeta(database, META_KEYS.watchlist);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const symbol = typeof item === 'string' ? cleanSymbol(item) : null;
      if (symbol !== null) seen.add(symbol);
    }
    return [...seen].slice(0, MAX_WATCHED);
  } catch {
    return [];
  }
}

async function write(database: SqliteDatabase, list: readonly string[]): Promise<void> {
  await writeMeta(database, META_KEYS.watchlist, JSON.stringify(list));
  // A change made here is waiting to go to the server (`investingSync.ts`).
  await writeMeta(database, META_KEYS.investingDirty, '1');
}

/** Newest first; one already watched moves to the front; the oldest beyond twenty go. Returns the new list. */
export async function watch(database: SqliteDatabase, text: string): Promise<readonly string[]> {
  const symbol = cleanSymbol(text);
  const current = await readWatchlist(database);
  if (symbol === null) return current;
  const next = [symbol, ...current.filter((s) => s !== symbol)].slice(0, MAX_WATCHED);
  await write(database, next);
  return next;
}

export async function unwatch(database: SqliteDatabase, text: string): Promise<readonly string[]> {
  const symbol = cleanSymbol(text);
  const next = (await readWatchlist(database)).filter((s) => s !== symbol);
  await write(database, next);
  return next;
}
