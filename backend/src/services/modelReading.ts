import { LIMITS } from '@expense-tracker/shared';
import { z } from 'zod';
import {
  currencyExponent,
  isPlausibleReceiptDate,
  RECEIPT_CATEGORY_KEYS,
  type ParsedReceipt,
} from './receiptParser.ts';

/**
 * What a vision model says about a receipt, made safe to show: `docs/design/14-ai-receipt-reading.md`.
 *
 * The model copies what is printed (a number in major units, a date, a name); this file does the
 * arithmetic and applies the same plausibility rules the OCR parser does, so both paths accept the
 * same things. An answer that is not the expected shape is a failed answer, never a partial one,
 * and the answer itself is never put in an error: it is text from a photo.
 */

const MAX_MERCHANT_LENGTH = 80;

/** Fields the model may leave out are `null`; the ones that decide how to read the rest are required. */
const ModelReading = z.object({
  isReceipt: z.boolean(),
  total: z.number().nullish(),
  printedCurrency: z.string().nullish(),
  date: z.string().nullish(),
  dateAmbiguous: z.boolean().nullish(),
  merchant: z.string().nullish(),
  category: z.string().nullish(),
});

/** The JSON schema the provider is asked to follow; the same shape as {@link ModelReading}. */
export const MODEL_READING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    isReceipt: { type: 'boolean' },
    total: { type: ['number', 'null'] },
    printedCurrency: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    dateAmbiguous: { type: 'boolean' },
    merchant: { type: ['string', 'null'] },
    category: { type: ['string', 'null'], enum: [...RECEIPT_CATEGORY_KEYS, null] },
  },
  required: [
    'isReceipt',
    'total',
    'printedCurrency',
    'date',
    'dateAmbiguous',
    'merchant',
    'category',
  ],
} as const;

export class ModelAnswerError extends Error {
  override readonly name = 'ModelAnswerError';
  constructor() {
    super('the model did not answer in the expected shape');
  }
}

export interface NormalizeOptions {
  /** The account's currency: how many decimals an amount has. */
  readonly currency: string;
  readonly today: Date;
}

export interface NormalizedReading {
  readonly receipt: ParsedReceipt;
  /** The receipt printed a currency other than the account's; the amount is still returned. */
  readonly currencyMismatch: boolean;
}

const EMPTY: ParsedReceipt = { amountMinor: null, date: null, merchant: null, category: null };

function toMinor(total: number | null | undefined, exponent: number): number | null {
  if (total === null || total === undefined || !Number.isFinite(total)) return null;
  // `toPrecision` first: 1.005 * 100 is 100.49999999999999, and a receipt means 1.01.
  const minor = Math.round(Number((total * 10 ** exponent).toPrecision(12)));
  return minor >= 1 && minor < LIMITS.AMOUNT_MINOR_MAX ? minor : null;
}

function cleanMerchant(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const clean = text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MERCHANT_LENGTH)
    .trim();
  return clean.length > 0 ? clean : null;
}

export function normalizeModelReading(
  answer: unknown,
  options: NormalizeOptions,
): NormalizedReading {
  const parsed = ModelReading.safeParse(answer);
  if (!parsed.success) throw new ModelAnswerError();
  const reading = parsed.data;
  if (!reading.isReceipt) return { receipt: EMPTY, currencyMismatch: false };

  const date = reading.date ?? null;
  const keepDate =
    date !== null && reading.dateAmbiguous !== true && isPlausibleReceiptDate(date, options.today);
  const category = RECEIPT_CATEGORY_KEYS.find((key) => key === reading.category) ?? null;
  const printed = reading.printedCurrency?.trim().toUpperCase();

  return {
    receipt: {
      amountMinor: toMinor(reading.total, currencyExponent(options.currency)),
      date: keepDate ? date : null,
      merchant: cleanMerchant(reading.merchant),
      category,
    },
    currencyMismatch:
      printed !== undefined && printed !== '' && printed !== options.currency.toUpperCase(),
  };
}
