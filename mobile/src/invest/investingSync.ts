import type { InvestingAlert, InvestingSettings } from '@expense-tracker/shared';
import { ALERTS_MAX, WATCHLIST_MAX } from '@expense-tracker/shared';
import type { ApiClient } from '../api/client';
import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { readAlerts } from './alerts';
import { readWatchlist } from './watchlist';

/**
 * Keeps this device's watchlist and price alerts level with the server's copy (`shared/src/investing.ts`), so a second
 * phone has them and so the server can push an alert while the app is closed.
 *
 * Local edits write the lists and mark them dirty (`watchlist.ts`, `alerts.ts`); this runs on every sync pass:
 *
 * - Nothing to send, and the server is ahead: take its document.
 * - Something to send: write it against the version last seen. If someone else wrote first the server says so
 *   (`applied: false`) and hands back its document; the two are merged and written again, once.
 * - The first time on an account (a different account than the lists were last kept for): the lists are the server's,
 *   never the previous account's.
 *
 * A merge is a union: there is no tombstone to say a removal was deliberate, so an alert removed on one phone while
 * the other edits at the same moment can come back. It is a settings list, and coming back is the safer mistake.
 */

const MAX_ROUNDS = 2;

interface Lists {
  readonly watchlist: readonly string[];
  readonly alerts: readonly InvestingAlert[];
}

function toAlerts(local: Awaited<ReturnType<typeof readAlerts>>): InvestingAlert[] {
  return local.map((a) => ({
    id: a.id,
    symbol: a.symbol,
    direction: a.direction,
    price: a.price,
    firedAt: a.firedAt,
    firedPrice: a.firedPrice,
  }));
}

async function readLists(database: SqliteDatabase): Promise<Lists> {
  return { watchlist: await readWatchlist(database), alerts: toAlerts(await readAlerts(database)) };
}

/** Write the lists without marking them dirty: they are the server's, or already merged with it. */
async function writeLists(database: SqliteDatabase, lists: Lists): Promise<void> {
  await writeMeta(database, META_KEYS.watchlist, JSON.stringify(lists.watchlist));
  await writeMeta(database, META_KEYS.priceAlerts, JSON.stringify(lists.alerts));
}

/** The server's order first, then what only this device has; an alert fired on either side stays fired. */
export function mergeLists(server: Lists, local: Lists): Lists {
  const watchlist = [...new Set([...server.watchlist, ...local.watchlist])].slice(0, WATCHLIST_MAX);
  const byId = new Map<string, InvestingAlert>();
  for (const alert of [...server.alerts, ...local.alerts]) {
    const known = byId.get(alert.id);
    byId.set(
      alert.id,
      known === undefined || (known.firedAt === null && alert.firedAt !== null) ? alert : known,
    );
  }
  return { watchlist, alerts: [...byId.values()].slice(0, ALERTS_MAX) };
}

const isEmpty = (lists: Lists): boolean =>
  lists.watchlist.length === 0 && lists.alerts.length === 0;

export type InvestingSyncResult = 'adopted' | 'sent' | 'merged' | 'unchanged' | 'failed';

export async function syncInvesting(
  api: Pick<ApiClient, 'getInvesting' | 'putInvesting'>,
  database: SqliteDatabase,
  userId: string,
): Promise<InvestingSyncResult> {
  const server: InvestingSettings = (await api.getInvesting()).data;
  const setVersion = (v: number) => writeMeta(database, META_KEYS.investingVersion, String(v));
  const setDirty = (dirty: boolean) =>
    writeMeta(database, META_KEYS.investingDirty, dirty ? '1' : '');

  // Someone else's lists (another account was signed in here): the server's are the truth now.
  if ((await readMeta(database, META_KEYS.investingOwner)) !== userId) {
    await writeLists(database, server);
    await setVersion(server.version);
    await setDirty(false);
    await writeMeta(database, META_KEYS.investingOwner, userId);
    return 'adopted';
  }

  const version = Number(await readMeta(database, META_KEYS.investingVersion)) || 0;
  let local = await readLists(database);
  // Lists made before this existed have never been sent: they count as an edit waiting.
  const dirty =
    (await readMeta(database, META_KEYS.investingDirty)) === '1' ||
    (version === 0 && server.version === 0 && !isEmpty(local));

  if (!dirty) {
    if (server.version <= version) return 'unchanged';
    await writeLists(database, server);
    await setVersion(server.version);
    return 'adopted';
  }

  let base = version;
  let merged = false;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const result = await api.putInvesting({
      watchlist: [...local.watchlist],
      alerts: [...local.alerts],
      baseVersion: base,
    });
    if (result.applied) {
      await setVersion(result.data.version);
      await setDirty(false);
      return merged ? 'merged' : 'sent';
    }
    // Lost the race: merge with what is there and try once more against that version.
    local = mergeLists(result.data, local);
    await writeLists(database, local);
    base = result.data.version;
    merged = true;
  }
  return 'failed';
}
