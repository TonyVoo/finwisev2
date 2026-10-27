import type { SqliteExecutor } from '../db/sqlite';

/**
 * The device's receipt rows. See the `receipts` migration for what each state means.
 *
 * These functions take an executor and know nothing about React or the network; the sync
 * step and the screens both go through them, so the rules about states live in one place.
 */

export type ReceiptState = 'pending-upload' | 'pending-delete' | 'synced' | 'remote';

export interface ReceiptRow {
  readonly expenseId: string;
  readonly state: ReceiptState;
  /** Base64 JPEG. Null for `pending-delete`, and for `remote` until it is downloaded. */
  readonly dataBase64: string | null;
  readonly sizeBytes: number;
  readonly updatedAt: string;
}

export async function readReceipt(
  executor: SqliteExecutor,
  expenseId: string,
): Promise<ReceiptRow | null> {
  return executor.getFirstAsync<ReceiptRow>(
    'SELECT expenseId, state, dataBase64, sizeBytes, updatedAt FROM receipts WHERE expenseId = ?',
    [expenseId],
  );
}

/** Whether the expense has a receipt as far as the person is concerned. */
export function hasReceipt(row: ReceiptRow | null): boolean {
  return row !== null && row.state !== 'pending-delete';
}

/** The person attached (or replaced) an image on this device. */
export async function attachReceipt(
  executor: SqliteExecutor,
  expenseId: string,
  dataBase64: string,
  at: string,
): Promise<void> {
  await executor.runAsync(
    `INSERT INTO receipts (expenseId, state, dataBase64, sizeBytes, updatedAt)
          VALUES (?, 'pending-upload', ?, ?, ?)
       ON CONFLICT (expenseId) DO UPDATE SET
            state = 'pending-upload', dataBase64 = excluded.dataBase64,
            sizeBytes = excluded.sizeBytes, updatedAt = excluded.updatedAt`,
    [expenseId, dataBase64, decodedSize(dataBase64), at],
  );
}

/**
 * The person removed the image. Always queued as a delete rather than dropped, because a
 * replaced image may already be on the server; the delete is idempotent there, and a 404
 * (the expense never reached the server) is also "done".
 */
export async function detachReceipt(
  executor: SqliteExecutor,
  expenseId: string,
  at: string,
): Promise<void> {
  const existing = await readReceipt(executor, expenseId);
  if (existing === null) return;
  await executor.runAsync(
    `UPDATE receipts SET state = 'pending-delete', dataBase64 = NULL, sizeBytes = 0, updatedAt = ?
      WHERE expenseId = ?`,
    [at, expenseId],
  );
}

/**
 * Drop a row, but only while it is still in the state (and version) the caller acted on.
 * A person who replaced the image mid-request must not have the new one deleted by the
 * answer to the old one.
 */
export async function deleteReceiptRow(
  executor: SqliteExecutor,
  expenseId: string,
  where: { readonly state: ReceiptState; readonly updatedAt: string } | null = null,
): Promise<void> {
  if (where === null) {
    await executor.runAsync('DELETE FROM receipts WHERE expenseId = ?', [expenseId]);
    return;
  }
  await executor.runAsync(
    'DELETE FROM receipts WHERE expenseId = ? AND state = ? AND updatedAt = ?',
    [expenseId, where.state, where.updatedAt],
  );
}

/** Rows the sync step has to push, uploads first. */
export async function pendingReceipts(executor: SqliteExecutor): Promise<readonly ReceiptRow[]> {
  return executor.getAllAsync<ReceiptRow>(
    `SELECT expenseId, state, dataBase64, sizeBytes, updatedAt FROM receipts
      WHERE state IN ('pending-upload', 'pending-delete')
      ORDER BY state DESC, updatedAt`,
    [],
  );
}

/** The server has the image uploaded at `uploadedAt` (the version the row carried then). */
export async function markSynced(
  executor: SqliteExecutor,
  expenseId: string,
  uploadedAt: string,
  sizeBytes: number,
  serverUpdatedAt: string,
): Promise<void> {
  await executor.runAsync(
    `UPDATE receipts SET state = 'synced', sizeBytes = ?, updatedAt = ?
      WHERE expenseId = ? AND state = 'pending-upload' AND updatedAt = ?`,
    [sizeBytes, serverUpdatedAt, expenseId, uploadedAt],
  );
}

/** Store an image fetched from the server for a `remote` (or stale `synced`) row. */
export async function storeDownloaded(
  executor: SqliteExecutor,
  expenseId: string,
  dataBase64: string,
  sizeBytes: number,
  updatedAt: string,
): Promise<void> {
  await executor.runAsync(
    `INSERT INTO receipts (expenseId, state, dataBase64, sizeBytes, updatedAt)
          VALUES (?, 'synced', ?, ?, ?)
       ON CONFLICT (expenseId) DO UPDATE SET
            state = 'synced', dataBase64 = excluded.dataBase64,
            sizeBytes = excluded.sizeBytes, updatedAt = excluded.updatedAt
          WHERE receipts.state IN ('synced', 'remote')`,
    [expenseId, dataBase64, sizeBytes, updatedAt],
  );
}

/** Bytes a base64 string decodes to, without decoding it. */
export function decodedSize(dataBase64: string): number {
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}
