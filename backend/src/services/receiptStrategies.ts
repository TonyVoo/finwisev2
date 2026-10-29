import { getConfig } from '../config.ts';
import { logger } from '../logger.ts';
import { createReceiptReader } from './geminiReader.ts';
import { normalizeModelReading } from './modelReading.ts';
import { parseReceiptText, type ParsedReceipt } from './receiptParser.ts';
import { ReaderQuotaError, type ReceiptReader, type ScanContext } from './receiptReader.ts';
import { getTextReader, type TextReader } from './textReader.ts';

export { ReaderQuotaError, type ReceiptReader, type ScanContext } from './receiptReader.ts';

/**
 * The ways to turn a receipt photo into suggestions, behind one `scan`: a vision model, or OCR text
 * through the parser. `scanReceipt` tries them in order; `docs/design/14-ai-receipt-reading.md`.
 */

export interface ReceiptStrategy {
  /** For a log line: which strategy failed. Never anything from the photo or a provider. */
  readonly name: string;
  /** Fields for the photo, or throws. {@link StrategySkipped} means "not tried", not "failed". */
  scan(image: Uint8Array, context: ScanContext): Promise<ParsedReceipt>;
}

/** The strategy was not tried (for now): its budget is spent. Not a failure of the reading. */
export class StrategySkipped extends Error {
  override readonly name = 'StrategySkipped';
  constructor() {
    super('strategy skipped');
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

let receiptReader: ReceiptReader | null | undefined;
let modelBudget: DailyBudget | undefined;

/**
 * Test seam: a reader, `null` for "no model", or `undefined` to read the configuration again.
 * The budget is the day's limit for the model, or the configured one when omitted.
 */
export function setReceiptReaderForTests(
  reader: ReceiptReader | null | undefined,
  dailyBudget?: number,
): void {
  receiptReader = reader;
  modelBudget = dailyBudget === undefined ? undefined : createDailyBudget(dailyBudget);
}

/** In the order they are tried: the model first, OCR + parser behind it. Empty means reading is off. */
export function getReceiptStrategies(): ReceiptStrategy[] {
  // `null` means "no model" and must stay that way; only `undefined` means "not built yet".
  if (receiptReader === undefined) receiptReader = createReceiptReader();
  modelBudget ??= createDailyBudget(getConfig().vision.geminiDailyBudget);
  const textReader = getTextReader();
  return [
    ...(receiptReader === null ? [] : [modelStrategy(receiptReader, modelBudget)]),
    ...(textReader === null ? [] : [textStrategy(textReader)]),
  ];
}
