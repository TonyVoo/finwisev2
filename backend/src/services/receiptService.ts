import { LIMITS, type Receipt, type ReceiptIndexItem } from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * Receipt photos: one JPEG per expense, stored inline in Postgres.
 *
 * Three rules that are easy to get subtly wrong:
 *
 *  * **The signature decides, not the declared type.** The bytes must start with the JPEG
 *    marker; a client that says `image/jpeg` over something else is a `validation_error`.
 *    Nothing here decodes or re-encodes the image - the server never runs an image library
 *    over untrusted input - so the check is the whole defence, and what is stored is only
 *    ever handed back as an opaque blob with a fixed content type.
 *  * **An expense that is not yours is `404`**, the same as one that does not exist, so ids
 *    cannot be probed. A deleted expense has no receipt to attach or read.
 *  * **Deleting is idempotent**, so a retried delete from the offline queue never fails.
 */

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function invalid(message: string) {
  return problems.validation(message, { issues: [{ path: 'dataBase64', message }] });
}

function decodeJpeg(dataBase64: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
  if (bytes.length === 0) throw invalid('The image is empty.');
  if (bytes.length > LIMITS.RECEIPT_MAX_BYTES) {
    throw invalid(`The image is larger than ${LIMITS.RECEIPT_MAX_BYTES} bytes.`);
  }
  if (!Buffer.from(bytes.subarray(0, 3)).equals(JPEG_SIGNATURE)) {
    throw invalid('The image is not a JPEG.');
  }
  return bytes;
}

function toWire(row: {
  expenseId: string;
  contentType: string;
  bytes: Uint8Array;
  sizeBytes: number;
  updatedAt: Date;
}): Receipt {
  return {
    expenseId: row.expenseId,
    contentType: 'image/jpeg',
    dataBase64: Buffer.from(row.bytes).toString('base64'),
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function putReceipt(
  db: Db,
  userId: string,
  expenseId: string,
  dataBase64: string,
  now: Date = new Date(),
): Promise<Receipt> {
  const expense = await db.expense.findFirst({ where: { id: expenseId, userId, deletedAt: null } });
  if (!expense) throw problems.notFound('No such expense.');

  const bytes = decodeJpeg(dataBase64);
  const row = await db.expenseReceipt.upsert({
    where: { expenseId },
    create: {
      expenseId,
      userId,
      contentType: 'image/jpeg',
      bytes,
      sizeBytes: bytes.length,
      updatedAt: now,
    },
    update: { bytes, sizeBytes: bytes.length, updatedAt: now },
  });
  logger.info('receipt stored', { userId, expenseId, sizeBytes: bytes.length });
  return toWire(row);
}

export async function getReceipt(db: Db, userId: string, expenseId: string): Promise<Receipt> {
  const row = await db.expenseReceipt.findFirst({
    where: { expenseId, userId, expense: { deletedAt: null } },
  });
  if (!row) throw problems.notFound('No receipt for this expense.');
  return toWire(row);
}

export async function deleteReceipt(db: Db, userId: string, expenseId: string): Promise<void> {
  // Any expense of the caller's, deleted or not: a retried delete after the expense itself
  // was removed must still succeed.
  const expense = await db.expense.findFirst({ where: { id: expenseId, userId } });
  if (!expense) throw problems.notFound('No such expense.');
  await db.expenseReceipt.deleteMany({ where: { expenseId, userId } });
}

export async function listReceipts(db: Db, userId: string): Promise<ReceiptIndexItem[]> {
  const rows = await db.expenseReceipt.findMany({
    where: { userId, expense: { deletedAt: null } },
    select: { expenseId: true, sizeBytes: true, updatedAt: true },
    orderBy: [{ updatedAt: 'asc' }, { expenseId: 'asc' }],
  });
  return rows.map((row) => ({
    expenseId: row.expenseId,
    sizeBytes: row.sizeBytes,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
