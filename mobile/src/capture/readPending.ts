import { Platform } from 'react-native';
import { drainPaymentNotifications } from './native';
import { ingestNotifications, pruneCaptured } from './store';
import type { SqliteDatabase } from '../db/sqlite';

/**
 * Brings what the native service kept into the database. Safe to call whenever: with nothing waiting, or off
 * Android, it does nothing. Returns how many new suggestions arrived.
 */
export async function readPendingNotifications(
  database: SqliteDatabase,
  now: number = Date.now(),
): Promise<number> {
  if (Platform.OS !== 'android') return 0;
  const waiting = drainPaymentNotifications();
  const added = waiting.length === 0 ? 0 : await ingestNotifications(database, waiting);
  await pruneCaptured(database, now);
  return added;
}
