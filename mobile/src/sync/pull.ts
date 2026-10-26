import type { ApiClient } from '../api/client';
import type { SqliteDatabase, SqliteExecutor } from '../db/sqlite';
import { applyServerRecord } from './apply';
import { INITIAL_CURSOR, readSyncCursor, writeSyncCursor } from './cursor';
import { countOutboxEntries } from './outbox';
import type { SessionGuard } from './sessionGuard';

/**
 * The pull: `GET /v1/sync?since=<cursor>` until `hasMore` is false.
 *
 * Three things in here are load-bearing and none of them is obvious from the endpoint:
 *
 * - **A page and the cursor that says it was applied share one transaction.** The
 *   contract asks for the watermark to be persisted "only after the whole page is
 *   written locally", and the reason is that the two failure modes are not symmetric: a
 *   cursor written early skips rows permanently and silently, while a cursor written
 *   late re-fetches a page whose writes are idempotent upserts. So the cheap mistake is
 *   the one this makes.
 * - **A tombstone is an ordinary row with `deletedAt` set**, applied like any other.
 *   `apply.ts` never deletes locally; the list queries already filter on it.
 * - **`resyncRequired` is only safe to honour when the outbox is empty.** It wipes the
 *   local database, and wiping it with undrained writes in it destroys work the server
 *   has never seen. `docs/design/02-offline-and-sync.md` §5.3 is explicit: push first,
 *   then wipe, and if the push cannot complete **do not wipe** - "a stale-but-intact
 *   local database is strictly better than a clean one missing the user's work."
 */

export interface PullDependencies {
  readonly database: SqliteDatabase;
  readonly api: Pick<ApiClient, 'pullSync'>;
  /** Progress for the `Catching up` screen (§5.3), reported after each applied page. */
  readonly onProgress?: (progress: PullProgress) => void;
  /**
   * Keeps the pass inside the session it began in (`sessionGuard.ts`): a page fetched for
   * user A is not written into user B's database. The engine always supplies one; optional
   * here only so the pull's own unit cases need not invent a session.
   */
  readonly guard?: SessionGuard;
}

export interface PullProgress {
  readonly pages: number;
  readonly changes: number;
  readonly hasMore: boolean;
  /** True while the pages being applied are part of a `resyncRequired` full download. */
  readonly resyncing: boolean;
}

export interface PullOutcome {
  readonly pages: number;
  readonly changes: number;
  /** The watermark now persisted. */
  readonly cursor: number;
  /** True when the local store was wiped and re-downloaded from cursor 0. */
  readonly resynced: boolean;
  /**
   * True when the server asked for a resync and the client refused, because the outbox
   * still held unsent work. Not an error: the next sync drains and tries again.
   */
  readonly resyncDeferred: boolean;
}

/**
 * Tables a resync empties.
 *
 * `outbox` is deliberately absent. It is empty by precondition - the caller checks, and
 * refuses to wipe otherwise - so listing it here would only mean that a future change
 * weakening that check destroyed the user's unsent writes instead of failing loudly.
 */
const RESYNC_TABLES = ['sync_rejections', 'expenses', 'categories'] as const;

async function wipeSyncedRows(txn: SqliteExecutor): Promise<void> {
  // `RESYNC_TABLES` is a literal, not input.
  for (const table of RESYNC_TABLES) {
    await txn.runAsync(`DELETE FROM ${table}`, []);
  }
  await writeSyncCursor(txn, INITIAL_CURSOR);
}

export async function pullChanges(deps: PullDependencies): Promise<PullOutcome> {
  const { database, api, onProgress, guard } = deps;

  let cursor = await readSyncCursor(database);
  let pages = 0;
  let changes = 0;
  let resynced = false;

  for (;;) {
    guard?.assertCurrent();
    const response = await api.pullSync({ since: cursor });
    // The page answers a request made under the session the pass began in.
    guard?.assertCurrent();

    if (response.resyncRequired) {
      if (resynced) {
        // A resync that starts from 0 and is told to resync again is a server fault, not
        // a state the client can work its way out of by asking a third time.
        break;
      }
      if ((await countOutboxEntries(database)) > 0) {
        return { pages, changes, cursor, resynced, resyncDeferred: true };
      }

      await database.withExclusiveTransactionAsync(async (txn) => {
        guard?.assertCurrent();
        await wipeSyncedRows(txn);
      });
      cursor = INITIAL_CURSOR;
      resynced = true;
      onProgress?.({ pages, changes, hasMore: true, resyncing: true });
      continue;
    }

    await database.withExclusiveTransactionAsync(async (txn) => {
      guard?.assertCurrent();
      for (const change of response.changes) {
        await applyServerRecord(txn, change);
      }
      await writeSyncCursor(txn, response.nextCursor);
    });

    pages += 1;
    changes += response.changes.length;
    const previous = cursor;
    cursor = response.nextCursor;
    onProgress?.({ pages, changes, hasMore: response.hasMore, resyncing: resynced });

    if (!response.hasMore) break;
    if (cursor <= previous) {
      // `hasMore` with a watermark that did not advance would ask for the same page
      // forever. Stop; the next trigger starts from the same place and loses nothing.
      break;
    }
  }

  return { pages, changes, cursor, resynced, resyncDeferred: false };
}
