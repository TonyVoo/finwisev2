import { z } from 'zod';
import { LIMITS, Timestamp, Uuid } from './primitives.js';

/**
 * A receipt photo attached to an expense: at most one per expense.
 *
 * Carried as base64 inside JSON so it rides the same transport, auth and error handling as
 * everything else; the app downsizes to a JPEG first, so the payload is a few hundred KB.
 * Receipts are deliberately **not** part of the sync cursor: an expense row is unchanged by
 * attaching one, so the client discovers them through `GET /v1/receipts` instead.
 */

export const ReceiptContentType = z.enum(['image/jpeg']);

const Base64 = z
  .string()
  .min(1)
  .max(LIMITS.RECEIPT_MAX_BASE64_LENGTH)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, { error: 'must be standard base64' });

export const ReceiptPutRequest = z.strictObject({
  contentType: ReceiptContentType,
  dataBase64: Base64.describe('The JPEG, base64-encoded. At most 1,500,000 bytes decoded.'),
});

export const Receipt = z.strictObject({
  expenseId: Uuid,
  contentType: ReceiptContentType,
  dataBase64: Base64,
  sizeBytes: z.number().int().positive(),
  updatedAt: Timestamp,
});

export const ReceiptResponse = z.strictObject({ data: Receipt });

/** A receipt without its bytes: what the client lists to learn which expenses have one. */
export const ReceiptIndexItem = z.strictObject({
  expenseId: Uuid,
  sizeBytes: z.number().int().positive(),
  updatedAt: Timestamp,
});

export const ReceiptIndexResponse = z.strictObject({ data: z.array(ReceiptIndexItem) });

export type ReceiptPutRequest = z.infer<typeof ReceiptPutRequest>;
export type Receipt = z.infer<typeof Receipt>;
export type ReceiptResponse = z.infer<typeof ReceiptResponse>;
export type ReceiptIndexItem = z.infer<typeof ReceiptIndexItem>;
export type ReceiptIndexResponse = z.infer<typeof ReceiptIndexResponse>;
