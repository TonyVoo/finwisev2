import { getConfig } from '../config.ts';
import { createQuickAddReader } from './geminiReader.ts';
import { createDailyBudget, type DailyBudget } from './receiptStrategies.ts';

/**
 * The model-side contract for reading a typed sentence (`docs/design/15-quick-add.md`), and which one
 * is configured. Kept beside the receipt strategies' pieces, not inside them: there is one model here and
 * no fallback, because the phone has already done what it can by itself.
 */

export interface QuickAddContext {
  /** The account's currency. */
  readonly currency: string;
  /** The phone's local date, `YYYY-MM-DD`. */
  readonly today: string;
}

/** A model that reads a sentence and answers with the fields, as untrusted JSON. */
export interface QuickAddReader {
  readSentence(text: string, context: QuickAddContext): Promise<unknown>;
}

let reader: QuickAddReader | null | undefined;
let budget: DailyBudget | undefined;

/** The process's reader, built from the configuration on first use. Null means it is off. */
export function getQuickAddReader(): QuickAddReader | null {
  // `null` means "no model" and must stay that way; only `undefined` means "not built yet".
  if (reader === undefined) reader = createQuickAddReader();
  return reader;
}

/** Quick add's own daily budget, apart from the receipt reading's. */
export function getQuickAddBudget(): DailyBudget {
  budget ??= createDailyBudget(getConfig().vision.geminiQuickAddDailyBudget);
  return budget;
}

/** Test seam: a reader, `null` for "no model", or `undefined` to read the configuration again. */
export function setQuickAddReaderForTests(
  next: QuickAddReader | null | undefined,
  dailyBudget?: number,
): void {
  reader = next;
  budget = dailyBudget === undefined ? undefined : createDailyBudget(dailyBudget);
}
