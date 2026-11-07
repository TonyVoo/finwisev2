import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { type PriceAlert, readAlerts } from '../invest/alerts';
import { type DcaPlan, readPlans } from '../invest/dca';

/**
 * What the notifications screen shows, and what the bell counts as new.
 *
 * There is no stored list of notifications: a fired price alert already carries when it fired and at what price, and a
 * plan is a reminder by nature, so the screen reads those two and the bell counts the alerts that fired after the person
 * last looked. Nothing here can disagree with what was actually announced.
 */

export interface Inbox {
  /** Fired alerts, newest first. */
  readonly fired: readonly PriceAlert[];
  readonly plans: readonly DcaPlan[];
  /** Fired since the screen was last opened. */
  readonly unread: number;
}

export function countUnread(alerts: readonly PriceAlert[], seenAt: string | null): number {
  return alerts.filter((a) => a.firedAt !== null && (seenAt === null || a.firedAt > seenAt)).length;
}

export async function readInbox(database: SqliteDatabase): Promise<Inbox> {
  const alerts = await readAlerts(database);
  const seenAt = await readMeta(database, META_KEYS.notificationsSeenAt);
  const fired = alerts
    .filter((a) => a.firedAt !== null)
    .sort((a, b) => (b.firedAt ?? '').localeCompare(a.firedAt ?? ''));
  return { fired, plans: await readPlans(database), unread: countUnread(alerts, seenAt) };
}

export async function markSeen(database: SqliteDatabase, now: Date): Promise<void> {
  await writeMeta(database, META_KEYS.notificationsSeenAt, now.toISOString());
}
