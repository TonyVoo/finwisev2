import { z } from 'zod';
import { CalendarDate, CurrencyCode, LIMITS, Timestamp, Uuid } from './primitives.js';

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

/**
 * `POST /v1/receipts/scan`: read a photo and suggest values. The body is the same JPEG as an
 * upload, but nothing is stored and no expense is involved. Every suggestion is nullable: what
 * the text does not clearly say is left out rather than guessed.
 */
export const ReceiptScanRequest = ReceiptPutRequest;

/** The default category a reading may point at; the app maps it to the person's own category. */
export const ReceiptCategoryKey = z.enum([
  'groceries',
  'eating_out',
  'transport',
  'health',
  'bills',
]);

export const ReceiptScan = z.strictObject({
  amountMinor: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('The total, in minor units of `currency`, or null when none was found.'),
  currency: CurrencyCode.describe("The account's currency, which the amount is read in."),
  date: CalendarDate.nullable().describe('The receipt date, or null.'),
  merchant: z.string().min(1).max(80).nullable().describe('The shop or business name, or null.'),
  category: ReceiptCategoryKey.nullable().describe('A suggested default category, or null.'),
});

export const ReceiptScanResponse = z.strictObject({ data: ReceiptScan });

export type ReceiptPutRequest = z.infer<typeof ReceiptPutRequest>;
export type Receipt = z.infer<typeof Receipt>;
export type ReceiptResponse = z.infer<typeof ReceiptResponse>;
export type ReceiptIndexItem = z.infer<typeof ReceiptIndexItem>;
export type ReceiptIndexResponse = z.infer<typeof ReceiptIndexResponse>;
export type ReceiptScanRequest = z.infer<typeof ReceiptScanRequest>;
export type ReceiptCategoryKey = z.infer<typeof ReceiptCategoryKey>;
export type ReceiptScan = z.infer<typeof ReceiptScan>;
export type ReceiptScanResponse = z.infer<typeof ReceiptScanResponse>;
