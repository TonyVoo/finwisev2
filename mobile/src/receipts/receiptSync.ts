import type { ApiClient } from '../api/client';
import { ApiRequestError } from '../api/errors';
import type { SqliteDatabase } from '../db/sqlite';
import type { SessionGuard } from '../sync/sessionGuard';
import { deleteReceiptRow, markSynced, pendingReceipts } from './receiptStore';

/**
 * The receipt half of a sync pass: push what was attached or removed here, then learn what
 * exists on the server.
 *
 * Receipts are not in the sync cursor (attaching one does not change the expense row), so
 * this runs after the main pass and has its own rules:
 *
 *  * **Uploads wait for their expense.** A `404` means the expense has not reached the server
 *    yet; the row stays queued and the next pass tries again - unless the expense is gone
 *    locally too, in which case the row is dropped rather than retried forever.
 *  * **Every write is conditional on the row still being what was sent.** The person can
 *    replace or remove an image while a request is in flight; the answer to the old request
 *    must not overwrite the new intent.
 *  * **The index only ever touches rows with nothing to push.** `pending-*` rows are the
 *    person's latest word and win until they have been delivered.
 *  * **It never blocks the main sync.** The caller treats a throw here as "try again next
 *    pass"; the expenses themselves have already synced.
 *
 * Returns whether any local row changed, so the caller can refresh what is on screen.
 */

export type ReceiptApi = Pick<ApiClient, 'putReceipt' | 'deleteReceipt' | 'listReceipts'>;

export interface ReceiptSyncDeps {
  readonly database: SqliteDatabase;
  readonly api: ReceiptApi;
  readonly guard: SessionGuard;
}

async function expenseIsLive(database: SqliteDatabase, expenseId: string): Promise<boolean> {
  const row = await database.getFirstAsync<{ present: number }>(
    'SELECT EXISTS (SELECT 1 FROM expenses WHERE id = ? AND deletedAt IS NULL) AS present',
    [expenseId],
  );
  return row?.present === 1;
}

function isStatus(error: unknown, ...statuses: number[]): error is ApiRequestError {
  return error instanceof ApiRequestError && statuses.includes(error.status);
}

export async function syncReceipts({ database, api, guard }: ReceiptSyncDeps): Promise<boolean> {
  let changed = false;

  for (const row of await pendingReceipts(database)) {
    guard.assertCurrent();
    if (row.state === 'pending-upload' && row.dataBase64 !== null) {
      try {
        const { data } = await api.putReceipt(row.expenseId, {
          contentType: 'image/jpeg',
          dataBase64: row.dataBase64,
        });
        guard.assertCurrent();
        await markSynced(database, row.expenseId, row.updatedAt, data.sizeBytes, data.updatedAt);
        changed = true;
      } catch (error) {
        if (isStatus(error, 404)) {
          if (!(await expenseIsLive(database, row.expenseId))) {
            guard.assertCurrent();
            await deleteReceiptRow(database, row.expenseId, row);
            changed = true;
          }
          continue;
        }
        // The server will never accept this image (not a JPEG, too large): drop it instead
        // of retrying a request that cannot succeed.
        if (isStatus(error, 400, 413)) {
          guard.assertCurrent();
          await deleteReceiptRow(database, row.expenseId, row);
          changed = true;
          continue;
        }
        throw error;
      }
    } else if (row.state === 'pending-delete') {
      try {
        await api.deleteReceipt(row.expenseId);
      } catch (error) {
        // 404: the expense is not on the server, so there is nothing to remove there.
        if (!isStatus(error, 404)) throw error;
      }
      guard.assertCurrent();
      await deleteReceiptRow(database, row.expenseId, row);
      changed = true;
    }
  }

  guard.assertCurrent();
  const { data: remote } = await api.listReceipts();
  guard.assertCurrent();

  const local = await database.getAllAsync<{ expenseId: string; state: string; updatedAt: string }>(
    'SELECT expenseId, state, updatedAt FROM receipts',
    [],
  );
  const localById = new Map(local.map((row) => [row.expenseId, row]));
  const remoteIds = new Set(remote.map((item) => item.expenseId));

  for (const item of remote) {
    const row = localById.get(item.expenseId);
    if (row === undefined) {
      await database.runAsync(
        `INSERT OR IGNORE INTO receipts (expenseId, state, dataBase64, sizeBytes, updatedAt)
              VALUES (?, 'remote', NULL, ?, ?)`,
        [item.expenseId, item.sizeBytes, item.updatedAt],
      );
      changed = true;
    } else if (
      (row.state === 'synced' || row.state === 'remote') &&
      item.updatedAt !== row.updatedAt
    ) {
      // Replaced on another device: forget the stale image; it is fetched when opened.
      await database.runAsync(
        `UPDATE receipts SET state = 'remote', dataBase64 = NULL, sizeBytes = ?, updatedAt = ?
          WHERE expenseId = ? AND state IN ('synced', 'remote') AND updatedAt = ?`,
        [item.sizeBytes, item.updatedAt, item.expenseId, row.updatedAt],
      );
      changed = true;
    }
  }

  for (const row of local) {
    if ((row.state === 'synced' || row.state === 'remote') && !remoteIds.has(row.expenseId)) {
      // Removed on another device, or its expense was deleted.
      await database.runAsync(
        `DELETE FROM receipts WHERE expenseId = ? AND state IN ('synced', 'remote') AND updatedAt = ?`,
        [row.expenseId, row.updatedAt],
      );
      changed = true;
    }
  }

  return changed;
}
