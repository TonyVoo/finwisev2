import { logger } from '../logger.ts';
import { normalizeModelReading } from './modelReading.ts';
import { parseReceiptText, type ParsedReceipt } from './receiptParser.ts';
import { getTextReader, type TextReader } from './textReader.ts';

/**
 * The ways to turn a receipt photo into suggestions, behind one `scan`: a vision model, or OCR text
 * through the parser. `scanReceipt` tries them in order; `docs/design/14-ai-receipt-reading.md`.
 */

export interface ScanContext {
  /** The account's currency. */
  readonly currency: string;
  readonly today: Date;
}

export interface ReceiptStrategy {
  /** For a log line: which strategy failed. Never anything from the photo or a provider. */
  readonly name: string;
  /** Fields for the photo, or throws. {@link StrategySkipped} means "not tried", not "failed". */
  scan(image: Uint8Array, context: ScanContext): Promise<ParsedReceipt>;
}

/** A model that looks at a photo and answers with the fields, as untrusted JSON. */
export interface ReceiptReader {
  readReceipt(image: Uint8Array, context: ScanContext): Promise<unknown>;
}

/** The strategy was not tried (for now): its budget is spent. Not a failure of the reading. */
export class StrategySkipped extends Error {
  override readonly name = 'StrategySkipped';
  constructor() {
    super('strategy skipped');
  }
}

/** A reader throws this when the provider says the quota is gone, so the rest of the day is skipped. */
export class ReaderQuotaError extends Error {
  override readonly name = 'ReaderQuotaError';
  constructor() {
    super('provider quota used up');
  }
}

// --- Daily budget -----------------------------------------------------------------------

/** The calendar day in Pacific time, when Google's daily quota resets. */
export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export interface DailyBudget {
  /** Spend one call if any are left today. */
  tryTake(now: Date): boolean;
  /** Spend what is left of today, for when the provider says it is out. */
  exhaust(now: Date): void;
}

/** Kept in memory, per process: with several instances each holds its own share, which is fine. */
export function createDailyBudget(limit: number): DailyBudget {
  let day = '';
  let used = 0;
  const roll = (now: Date) => {
    const today = pacificDay(now);
    if (today !== day) {
      day = today;
      used = 0;
    }
  };
  return {
    tryTake(now) {
      roll(now);
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    exhaust(now) {
      roll(now);
      used = Math.max(used, limit);
    },
  };
}

// --- Strategies -------------------------------------------------------------------------

export function modelStrategy(reader: ReceiptReader, budget: DailyBudget): ReceiptStrategy {
  return {
    name: 'model',
    async scan(image, context) {
      if (!budget.tryTake(context.today)) throw new StrategySkipped();
      let answer: unknown;
      try {
        answer = await reader.readReceipt(image, context);
      } catch (error) {
        if (error instanceof ReaderQuotaError) budget.exhaust(context.today);
        throw error;
      }
      const { receipt, currencyMismatch } = normalizeModelReading(answer, context);
      if (currencyMismatch) logger.info('receipt printed another currency', { strategy: 'model' });
      return receipt;
    },
  };
}

export function textStrategy(reader: TextReader): ReceiptStrategy {
  return {
    name: 'ocr',
    async scan(image, context) {
      return parseReceiptText(await reader.readText(image), context);
    },
  };
}

// --- What is configured -----------------------------------------------------------------

/** Well under a free tier's daily quota; the Gemini client (step 2) reads its own from config. */
const DEFAULT_DAILY_BUDGET = 500;

let receiptReader: ReceiptReader | null = null;
let modelBudget = createDailyBudget(DEFAULT_DAILY_BUDGET);

/** Test seam, and where the configured model is installed: a reader or `null` for none. */
export function setReceiptReaderForTests(
  reader: ReceiptReader | null,
  dailyBudget: number = DEFAULT_DAILY_BUDGET,
): void {
  receiptReader = reader;
  modelBudget = createDailyBudget(dailyBudget);
}

/** In the order they are tried: the model first, OCR + parser behind it. Empty means reading is off. */
export function getReceiptStrategies(): ReceiptStrategy[] {
  const textReader = getTextReader();
  return [
    ...(receiptReader === null ? [] : [modelStrategy(receiptReader, modelBudget)]),
    ...(textReader === null ? [] : [textStrategy(textReader)]),
  ];
}
