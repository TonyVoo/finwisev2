import type { ReceiptScan } from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { decodeJpeg } from './receiptService.ts';
import {
  getReceiptStrategies,
  StrategySkipped,
  type ReceiptStrategy,
} from './receiptStrategies.ts';

/**
 * Reading a receipt photo into suggestions: `docs/design/11-receipt-scan.md` and, for the
 * vision-model strategy, `docs/design/14-ai-receipt-reading.md`.
 *
 * Stores nothing: the image is checked, read, and dropped, and neither it nor anything read from
 * it is logged. The order is deliberate - validate first (an unreadable file never reaches a
 * provider), then ask whether reading is set up, then spend provider calls.
 *
 * Strategies are tried in order and the first that answers wins. One that fails is logged by class
 * only (a provider's message can name a key or a quota) and the next is tried. When none answered:
 * `ocr_failed` if any was tried and failed, `ocr_unavailable` if none could be tried (nothing is
 * configured, or what is configured is out of budget for today).
 */
export async function scanReceipt(
  db: Db,
  userId: string,
  dataBase64: string,
  now: Date = new Date(),
  strategies: readonly ReceiptStrategy[] = getReceiptStrategies(),
): Promise<ReceiptScan> {
  const image = decodeJpeg(dataBase64);
  if (strategies.length === 0) throw problems.ocrUnavailable();

  const user = await db.user.findUnique({ where: { id: userId }, select: { currency: true } });
  if (user === null) throw problems.notFound('No such account.');

  const context = { currency: user.currency, today: now };
  let failed = false;
  for (const strategy of strategies) {
    try {
      const found = await strategy.scan(image, context);
      // Which strategy answered, so "is the model being used" is visible. Nothing from the photo.
      logger.info('receipt read', { userId, strategy: strategy.name });
      return {
        amountMinor: found.amountMinor,
        currency: user.currency,
        date: found.date,
        merchant: found.merchant,
        category: found.category,
      };
    } catch (error) {
      if (error instanceof StrategySkipped) continue;
      failed = true;
      logger.warn('receipt reading failed', {
        userId,
        strategy: strategy.name,
        reason: (error as Error).name,
      });
    }
  }
  throw failed ? problems.ocrFailed() : problems.ocrUnavailable();
}
