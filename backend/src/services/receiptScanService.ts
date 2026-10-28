import type { ReceiptScan } from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { parseReceiptText } from './receiptParser.ts';
import { decodeJpeg } from './receiptService.ts';
import { getTextReader, type TextReader } from './textReader.ts';

/**
 * Reading a receipt photo into suggestions: `docs/design/11-receipt-scan.md`.
 *
 * Stores nothing: the image is checked, read, and dropped, and neither it nor the text read
 * from it is logged. The order is deliberate - validate first (an unreadable file never reaches
 * the provider), then ask whether reading is set up, then spend the provider call.
 */
export async function scanReceipt(
  db: Db,
  userId: string,
  dataBase64: string,
  now: Date = new Date(),
  reader: TextReader | null = getTextReader(),
): Promise<ReceiptScan> {
  const image = decodeJpeg(dataBase64);
  if (reader === null) throw problems.ocrUnavailable();

  const user = await db.user.findUnique({ where: { id: userId }, select: { currency: true } });
  if (user === null) throw problems.notFound('No such account.');

  let text: string;
  try {
    text = await reader.readText(image);
  } catch (error) {
    // The class of failure only: a provider's message can name a key or a quota.
    logger.warn('receipt reading failed', { userId, reason: (error as Error).name });
    throw problems.ocrFailed();
  }

  const found = parseReceiptText(text, { currency: user.currency, today: now });
  return {
    amountMinor: found.amountMinor,
    currency: user.currency,
    date: found.date,
    merchant: found.merchant,
    category: found.category,
  };
}
