import { getConfig } from '../config.ts';
import { createRecapReader } from './geminiReader.ts';
import { createDailyBudget, type DailyBudget } from './receiptStrategies.ts';

/**
 * The model-side contract for writing a month's recap (`docs/design/16-monthly-insights.md`), and which one
 * is configured. One model and no fallback: if it cannot be used the Insights card is simply as it was.
 */

export interface RecapInput {
  /** The month in words, in the request's language ("October 2026", "tháng 10 năm 2026"). */
  readonly monthLabel: string;
  readonly language: 'en' | 'vi';
  /** The insight sentences to reword. */
  readonly facts: readonly string[];
}

/** A model that rewords facts as a short recap, as untrusted JSON. */
export interface RecapReader {
  writeRecap(input: RecapInput): Promise<unknown>;
}

let reader: RecapReader | null | undefined;
let budget: DailyBudget | undefined;

/** The process's reader, built from the configuration on first use. Null means it is off. */
export function getRecapReader(): RecapReader | null {
  // `null` means "no model" and must stay that way; only `undefined` means "not built yet".
  if (reader === undefined) reader = createRecapReader();
  return reader;
}

/** The recap's own daily budget, apart from receipts' and quick add's. */
export function getRecapBudget(): DailyBudget {
  budget ??= createDailyBudget(getConfig().vision.geminiRecapDailyBudget);
  return budget;
}

/** Test seam: a reader, `null` for "no model", or `undefined` to read the configuration again. */
export function setRecapReaderForTests(
  next: RecapReader | null | undefined,
  dailyBudget?: number,
): void {
  reader = next;
  budget = dailyBudget === undefined ? undefined : createDailyBudget(dailyBudget);
}
