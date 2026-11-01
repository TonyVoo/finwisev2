import { z } from 'zod';
import { CalendarDate, CurrencyCode, LIMITS } from './primitives.js';
import { ReceiptCategoryKey } from './receipt.js';

/**
 * `POST /v1/quick-add`: read a typed sentence ("coffee 45k yesterday") and suggest an expense
 * (`docs/design/15-quick-add.md`). Nothing is stored and no expense is involved. Every suggestion is
 * nullable: what the sentence does not clearly say is left out rather than guessed, and the app only
 * ever offers the values for the person to accept.
 *
 * The phone reads what it can by itself first; this is asked only for a sentence it was unsure about.
 */

export const QuickAddRequest = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(LIMITS.QUICK_ADD_TEXT_MAX)
    .regex(/\S/, { error: 'must contain something other than spaces' })
    .describe('The sentence the person typed, at most 300 characters.'),
  today: CalendarDate.describe(
    'The phone\'s local date, which "yesterday" and a weekday are relative to. The server rejects one more than a day from its own clock.',
  ),
});

export const QuickAddSuggestion = z.strictObject({
  type: z
    .enum(['expense', 'income'])
    .nullable()
    .describe('Whether the sentence describes money spent or money received, or null.'),
  amountMinor: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('The amount, in minor units of `currency`, or null when none was clear.'),
  currency: CurrencyCode.describe("The account's currency, which the amount is read in."),
  date: CalendarDate.nullable().describe('The date, never after `today`, or null.'),
  note: z
    .string()
    .min(1)
    .max(LIMITS.EXPENSE_NOTE_MAX)
    .nullable()
    .describe('What it was for, without the amount or the date, or null.'),
  category: ReceiptCategoryKey.nullable().describe('A suggested default category, or null.'),
});

export const QuickAddResponse = z.strictObject({ data: QuickAddSuggestion });

export type QuickAddRequest = z.infer<typeof QuickAddRequest>;
export type QuickAddSuggestion = z.infer<typeof QuickAddSuggestion>;
export type QuickAddResponse = z.infer<typeof QuickAddResponse>;
