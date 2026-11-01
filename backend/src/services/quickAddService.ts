import type { QuickAddRequest, QuickAddSuggestion } from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { normalizeQuickAddAnswer } from './quickAddReading.ts';
import { getQuickAddBudget, getQuickAddReader, type QuickAddReader } from './quickAddReader.ts';
import { ReaderQuotaError } from './receiptReader.ts';
import { safeDetail } from './safeDetail.ts';
import type { DailyBudget } from './receiptStrategies.ts';

/**
 * Reading a typed sentence into a suggestion: `docs/design/15-quick-add.md`.
 *
 * Stores nothing, and neither the sentence nor the answer is ever logged. The order is deliberate:
 * validate first (a request that cannot be answered never reaches the model), then ask whether a model is
 * set up, then spend one call of the day's budget. When the model is off or the budget is spent the
 * answer is `quick_add_unavailable`, and when it fails, `quick_add_failed`; neither blocks anything,
 * because the phone has already read what it could by itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `today` is the phone's date, so a time zone can put it a day either side of the server's, and no more. */
function requireNearToday(today: string, now: Date): void {
  const phone = Date.parse(`${today}T00:00:00Z`);
  const server = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Math.abs(phone - server) > DAY_MS) {
    throw problems.validation("`today` is more than a day from the server's date.");
  }
}

export async function quickAdd(
  db: Db,
  userId: string,
  request: QuickAddRequest,
  now: Date = new Date(),
  reader: QuickAddReader | null = getQuickAddReader(),
  budget: DailyBudget = getQuickAddBudget(),
): Promise<QuickAddSuggestion> {
  requireNearToday(request.today, now);
  if (reader === null) throw problems.quickAddUnavailable();

  const user = await db.user.findUnique({ where: { id: userId }, select: { currency: true } });
  if (user === null) throw problems.notFound('No such account.');
  if (!budget.tryTake(now)) throw problems.quickAddUnavailable();

  try {
    const found = normalizeQuickAddAnswer(
      await reader.readSentence(request.text.trim(), {
        currency: user.currency,
        today: request.today,
      }),
      { currency: user.currency, today: request.today },
    );
    // Which strategy answered, so "is the model being used" is visible. Nothing from the sentence.
    logger.info('quick add read', { userId, strategy: 'model' });
    return { ...found, currency: user.currency };
  } catch (error) {
    if (error instanceof ReaderQuotaError) budget.exhaust(now);
    // The class of failure, and an adapter's own fixed message: never anything the model or the person said.
    logger.warn('quick add failed', {
      userId,
      strategy: 'model',
      reason: (error as Error).name,
      ...safeDetail(error),
    });
    throw problems.quickAddFailed();
  }
}
