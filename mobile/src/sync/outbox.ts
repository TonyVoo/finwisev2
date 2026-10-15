import { LIMITS, SYNC_APPLY_ORDER, type SyncEntity } from '@expense-tracker/shared';
import type { SqliteExecutor } from '../db/sqlite';

/**
 * Reading and retiring outbox entries - the queue side of the drain.
 *
 * Four properties of the table drive everything in here, and three of them are easy to
 * get wrong from memory rather than from the schema:
 *
 * - **The primary key is `seq`, and there is no `id` column.** `AUTOINCREMENT`, so a
 *   rowid freed by a drained entry is never handed to a later one; a plain rowid would
 *   let a new mutation sort ahead of an older one and push an edit before the create it
 *   depends on.
 * - **`clientMutationId` is `UNIQUE`**, which is what makes matching a push result back
 *   to its entry an exact single-row lookup rather than a positional guess.
 * - **Entries are appended, never coalesced.** Three edits to one expense are three
 *   entries. `docs/design/02-offline-and-sync.md` §2 rule 2 describes a client that
 *   coalesces at enqueue time; `write.ts` does not, and the append shape is the one this
 *   module is built for - see the note in `push.ts` on why merging into an entry that
 *   may already be in flight is unsafe. Raised as a doc amendment on `TVO-24`.
 * - **A row is `pending` iff an undrained entry names it.** Nothing stores that flag, so
 *   nothing can disagree with the queue.
 */

/** One queued mutation. `fields` is null when the stored JSON will not parse. */
export interface OutboxEntry {
  readonly seq: number;
  readonly entity: SyncEntity;
  readonly recordId: string;
  /**
   * The mutated fields only, matching `CategorySyncFields` / `ExpenseSyncFields`. Null
   * means the stored JSON is unreadable, which is store corruption rather than a user
   * error - the drain retires such an entry instead of failing every push behind it.
   */
  readonly fields: Record<string, unknown> | null;
  readonly updatedAt: string;
  readonly clientMutationId: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

interface OutboxRow {
  readonly seq: number;
  readonly entity: SyncEntity;
  readonly recordId: string;
  readonly fields: string;
  readonly updatedAt: string;
  readonly clientMutationId: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

/**
 * `ORDER BY` fragment putting categories before expenses, then FIFO within each.
 *
 * Derived from `SYNC_APPLY_ORDER` rather than written out, so the client's push order
 * cannot drift from the order the server applies a batch in. An expense created offline
 * against a category created offline in the same session needs exactly this to sync in
 * one round trip.
 */
const ENTITY_RANK = `CASE entity ${SYNC_APPLY_ORDER.map(
  (entity, index) => `WHEN '${entity}' THEN ${index}`,
).join(' ')} ELSE ${SYNC_APPLY_ORDER.length} END`;

function toEntry(row: OutboxRow): OutboxEntry {
  let fields: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(row.fields);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    fields = null;
  }
  return { ...row, fields };
}

/**
 * The next batch to push: categories first, then expenses, FIFO within each.
 *
 * Capped at the contract's batch maximum, because the server answers a larger batch with
 * `413 batch_too_large` - a failure the client can and should avoid rather than discover.
 * A backlog bigger than one batch drains over several round trips; `push.ts` loops.
 */
export async function readOutboxBatch(
  executor: SqliteExecutor,
  limit: number = LIMITS.SYNC_MAX_BATCH_SIZE,
): Promise<readonly OutboxEntry[]> {
  const rows = await executor.getAllAsync<OutboxRow>(
    `SELECT seq, entity, recordId, fields, updatedAt, clientMutationId, attempts, lastError
       FROM outbox
      ORDER BY ${ENTITY_RANK}, seq
      LIMIT ?`,
    [Math.min(limit, LIMITS.SYNC_MAX_BATCH_SIZE)],
  );
  return rows.map(toEntry);
}

/** Undrained entries for one record, oldest first. The replay order in `apply.ts`. */
export async function readOutboxFor(
  executor: SqliteExecutor,
  entity: SyncEntity,
  recordId: string,
): Promise<readonly OutboxEntry[]> {
  const rows = await executor.getAllAsync<OutboxRow>(
    `SELECT seq, entity, recordId, fields, updatedAt, clientMutationId, attempts, lastError
       FROM outbox
      WHERE entity = ? AND recordId = ?
      ORDER BY seq`,
    [entity, recordId],
  );
  return rows.map(toEntry);
}

export async function countOutboxEntries(executor: SqliteExecutor): Promise<number> {
  const row = await executor.getFirstAsync<{ entries: number }>(
    'SELECT COUNT(*) AS entries FROM outbox',
    [],
  );
  return row?.entries ?? 0;
}

/** Retire entries the server has answered. Called inside the drain's transaction. */
export async function deleteOutboxEntries(
  txn: SqliteExecutor,
  seqs: readonly number[],
): Promise<void> {
  for (const seq of seqs) {
    await txn.runAsync('DELETE FROM outbox WHERE seq = ?', [seq]);
  }
}

/**
 * Record that a push attempt did not get an answer for these entries.
 *
 * `attempts` and `lastError` are diagnostics, not a retry budget: an entry is never
 * dropped for having failed too often, because the overwhelming cause is being offline
 * and a transport failure says nothing about whether the mutation is valid. The entries
 * the client *does* give up on are the ones the server explicitly refused, and those are
 * retired with a rejection row instead (`push.ts`).
 */
export async function recordOutboxAttempt(
  executor: SqliteExecutor,
  seqs: readonly number[],
  error: string,
): Promise<void> {
  for (const seq of seqs) {
    await executor.runAsync(
      'UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE seq = ?',
      [error.slice(0, 500), seq],
    );
  }
}
