import {
  SYNC_RECORD_ERROR_CODES,
  type SyncEntity,
  type SyncRecordErrorCode,
} from '@expense-tracker/shared';
import type { SqliteExecutor } from '../db/sqlite';

/**
 * Rows the server refused, and the `needs-attention` state derived from them.
 *
 * A push that comes back `invalid` has told the client something retrying cannot fix -
 * an expense pointing at a category another device deleted, a name already taken, a
 * create that is missing a required field. So the outbox entry is retired rather than
 * retried: an entry that retries forever is a battery and bandwidth leak with no path
 * to success, and it is invisible, because nothing in the UI counts attempts.
 *
 * Retiring it alone would be worse than the leak, though. The row would stop showing
 * the `pending` clock and start looking settled, while the server has never stored it -
 * the user's expense exists on exactly one device and nothing says so. The rejection
 * row is what keeps that visible (`docs/design/02-offline-and-sync.md` §5.1).
 *
 * **`needs-attention` is derived, never stored on the row**: a rejection names the
 * record *and* nothing in the outbox does. Re-queueing the record - which is what
 * saving the repaired expense does - therefore clears the marker on its own, with no
 * second write that a future write path could forget to make.
 */

export interface SyncRejection {
  readonly entity: SyncEntity;
  readonly recordId: string;
  /**
   * One of `SYNC_RECORD_ERROR_CODES`, or `unknown_error` for anything outside that set.
   * The contract says a code outside it is a server fault reported as a 500 for the
   * whole batch rather than per record, so reaching this type means something upstream
   * broke its own rule - which is worth recording rather than crashing on.
   */
  readonly code: SyncRecordErrorCode | 'unknown_error';
  readonly message: string;
  readonly rejectedAt: string;
}

/** A rejection as the drain has it: `code` is whatever the server said, unnarrowed. */
export interface SyncRejectionInput extends Omit<SyncRejection, 'code'> {
  readonly code: string;
}

function toRecordErrorCode(code: string): SyncRejection['code'] {
  return (SYNC_RECORD_ERROR_CODES as readonly string[]).includes(code)
    ? (code as SyncRecordErrorCode)
    : 'unknown_error';
}

export async function recordRejection(
  txn: SqliteExecutor,
  rejection: SyncRejectionInput,
): Promise<void> {
  await txn.runAsync(
    `INSERT INTO sync_rejections (entity, recordId, code, message, rejectedAt)
          VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (entity, recordId) DO UPDATE SET
          code = excluded.code, message = excluded.message, rejectedAt = excluded.rejectedAt`,
    [
      rejection.entity,
      rejection.recordId,
      toRecordErrorCode(rejection.code),
      rejection.message,
      rejection.rejectedAt,
    ],
  );
}

export async function clearRejection(
  txn: SqliteExecutor,
  entity: SyncEntity,
  recordId: string,
): Promise<void> {
  await txn.runAsync('DELETE FROM sync_rejections WHERE entity = ? AND recordId = ?', [
    entity,
    recordId,
  ]);
}

/**
 * Records currently in `needs-attention`: refused by the server and not since re-queued.
 *
 * The `NOT EXISTS` is the derivation, and it is the reason nothing has to remember to
 * clear a flag when the user fixes a row.
 */
export async function listNeedsAttention(
  executor: SqliteExecutor,
): Promise<readonly SyncRejection[]> {
  const rows = await executor.getAllAsync<{
    entity: SyncEntity;
    recordId: string;
    code: string;
    message: string;
    rejectedAt: string;
  }>(
    `SELECT r.entity, r.recordId, r.code, r.message, r.rejectedAt
       FROM sync_rejections r
      WHERE NOT EXISTS (
            SELECT 1 FROM outbox o WHERE o.entity = r.entity AND o.recordId = r.recordId
          )
      ORDER BY r.rejectedAt, r.recordId`,
    [],
  );
  return rows.map((row) => ({ ...row, code: toRecordErrorCode(row.code) }));
}
