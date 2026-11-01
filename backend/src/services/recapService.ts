import type { RecapRequest, RecapText } from '@expense-tracker/shared';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { getRecapBudget, getRecapReader, type RecapReader } from './recapReader.ts';
import { monthLabel, normalizeRecapAnswer } from './recapWriting.ts';
import { ReaderQuotaError } from './receiptReader.ts';
import type { DailyBudget } from './receiptStrategies.ts';
import { safeDetail } from './safeDetail.ts';

/**
 * Writing a month's recap from the insight sentences the phone sends: `docs/design/16-monthly-insights.md`.
 *
 * Stores nothing, and neither the facts nor the text is ever logged. Like the other model-backed routes: ask
 * whether a model is set up, then spend one call of the day's budget. Unavailable and failed are different
 * answers, and neither affects the Insights card, which is computed on the phone.
 */
export async function writeRecap(
  userId: string,
  request: RecapRequest,
  now: Date = new Date(),
  reader: RecapReader | null = getRecapReader(),
  budget: DailyBudget = getRecapBudget(),
): Promise<RecapText> {
  if (reader === null) throw problems.recapUnavailable();
  if (!budget.tryTake(now)) throw problems.recapUnavailable();

  const facts = request.facts.map((fact) => fact.trim());
  try {
    const text = normalizeRecapAnswer(
      await reader.writeRecap({
        monthLabel: monthLabel(request.month, request.language),
        language: request.language,
        facts,
      }),
      { month: request.month, facts },
    );
    // Which strategy answered, so "is the model being used" is visible. Nothing from the facts or the text.
    logger.info('recap written', { userId, strategy: 'model' });
    return { text };
  } catch (error) {
    if (error instanceof ReaderQuotaError) budget.exhaust(now);
    // The class of failure, and an adapter's own fixed message: never anything the model or the facts said.
    logger.warn('recap failed', {
      userId,
      strategy: 'model',
      reason: (error as Error).name,
      ...safeDetail(error),
    });
    throw problems.recapFailed();
  }
}
