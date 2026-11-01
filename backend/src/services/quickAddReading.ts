import { z } from 'zod';
import { LIMITS } from '@expense-tracker/shared';
import { cleanText, ModelAnswerError, toMinor } from './modelReading.ts';
import {
  currencyExponent,
  isPlausibleReceiptDate,
  RECEIPT_CATEGORY_KEYS,
} from './receiptParser.ts';

/**
 * What a model says about a typed sentence, made safe to offer: `docs/design/15-quick-add.md`.
 *
 * The same discipline as `modelReading.ts` for receipts: the model copies and expands what was typed
 * (a number in major units, a date, a note), this file does the arithmetic and applies the plausibility
 * rules, and an answer that is not the expected shape is a failed answer, never a partial one. The
 * sentence is the person's own typing, but it is still data: it is never interpreted here.
 */

const Answer = z.object({
  kind: z.string().nullish(),
  amount: z.number().nullish(),
  date: z.string().nullish(),
  dateAmbiguous: z.boolean().nullish(),
  note: z.string().nullish(),
  category: z.string().nullish(),
});

export interface QuickAddFields {
  readonly type: 'expense' | 'income' | null;
  readonly amountMinor: number | null;
  readonly date: string | null;
  readonly note: string | null;
  readonly category: (typeof RECEIPT_CATEGORY_KEYS)[number] | null;
}

export interface QuickAddNormalizeOptions {
  /** The account's currency: how many decimals an amount has. */
  readonly currency: string;
  /** The phone's local date, `YYYY-MM-DD`: nothing can be after it. */
  readonly today: string;
}

export function normalizeQuickAddAnswer(
  answer: unknown,
  options: QuickAddNormalizeOptions,
): QuickAddFields {
  const parsed = Answer.safeParse(answer);
  if (!parsed.success) throw new ModelAnswerError();
  const reading = parsed.data;

  const date = reading.date ?? null;
  const keepDate =
    date !== null &&
    reading.dateAmbiguous !== true &&
    date <= options.today &&
    isPlausibleReceiptDate(date, new Date(`${options.today}T00:00:00Z`));

  return {
    type: reading.kind === 'expense' || reading.kind === 'income' ? reading.kind : null,
    amountMinor: toMinor(reading.amount, currencyExponent(options.currency)),
    date: keepDate ? date : null,
    note: cleanText(reading.note, LIMITS.EXPENSE_NOTE_MAX),
    category: RECEIPT_CATEGORY_KEYS.find((key) => key === reading.category) ?? null,
  };
}
