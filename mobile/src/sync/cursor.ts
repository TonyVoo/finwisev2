import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { SqliteExecutor } from '../db/sqlite';

/**
 * The pull watermark.
 *
 * A **revision**, not a timestamp: the server assigns a per-user monotonic sequence on
 * every write and `GET /v1/sync?since=` returns rows above it (`docs/PLAN.md` §4). The
 * reason that distinction is worth a module comment is that a timestamp cursor looks
 * identical and silently loses writes - two rows stamped the same millisecond, or a
 * cursor advanced past a transaction that had not committed yet, and a record is never
 * delivered at all.
 *
 * It is persisted because the alternative is a full download on every cold start.
 * **When** it is persisted matters as much: the contract says to store `nextCursor`
 * "only after the whole page is written locally", so a crash between receiving a page
 * and applying it re-fetches that page rather than skipping it. Applying a page and
 * advancing the cursor therefore share one transaction.
 */

/** Cursor meaning "I have seen nothing"; also what a `resyncRequired` wipe resets to. */
export const INITIAL_CURSOR = 0;

export async function readSyncCursor(executor: SqliteExecutor): Promise<number> {
  const stored = await readMeta(executor, META_KEYS.syncCursor);
  if (stored === null) return INITIAL_CURSOR;

  // A non-numeric or negative value can only come from a corrupted store. Falling back
  // to 0 re-pulls everything, which is slow but correct; trusting it could skip rows.
  const parsed = Number(stored);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : INITIAL_CURSOR;
}

export async function writeSyncCursor(executor: SqliteExecutor, cursor: number): Promise<void> {
  await writeMeta(executor, META_KEYS.syncCursor, String(cursor));
}

export async function readLastSyncedAt(executor: SqliteExecutor): Promise<string | null> {
  return await readMeta(executor, META_KEYS.lastSyncedAt);
}

export async function writeLastSyncedAt(
  executor: SqliteExecutor,
  timestamp: string,
): Promise<void> {
  await writeMeta(executor, META_KEYS.lastSyncedAt, timestamp);
}
