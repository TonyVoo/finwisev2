import { z } from 'zod';
import {
  AmountMinor,
  CalendarDate,
  CurrencyCode,
  LIMITS,
  OpaqueCursor,
  Uuid,
} from './primitives.js';
import { SYNCABLE_SHAPE } from './syncable.js';

/**
 * An expense. Money is `amountMinor` + `currency`; the day it happened is the
 * zone-less calendar `date`. Monthly totals bucket on `date`, never on `createdAt`.
 */

export const ExpenseNote = z
  .string()
  .trim()
  .max(LIMITS.EXPENSE_NOTE_MAX)
  .describe('Free-text note, up to 500 characters after trimming.');

/**
 * A note as a client *sends* it: trimmed, and a note that trims to nothing is `null`.
 *
 * `ExpenseNote` alone trims but cannot collapse `"   "` to "no note" - the result is `""`,
 * which is not nullish, so a writer's `input.note ?? null` leaves it alone and the column
 * ends up with two spellings of "no note" that every later reader has to know about
 * (`TVO-39`, `EDGE-09`). Normalising here, on the input side of the contract, means the
 * REST create and patch shapes and the sync push fields all give the same answer, and no
 * server writer has to remember to do it.
 *
 * Input shapes use this; the *response* shapes keep plain `ExpenseNote`, since a row the
 * server reports has already been through here.
 */
export const ExpenseNoteInput = ExpenseNote.nullable().transform((value) =>
  value === '' ? null : value,
);

/**
 * Whether a row is money out or money in. Income lives in the same table as expenses so it
 * syncs, exports and attaches receipts the same way; every spend total filters on `expense`.
 */
export const EntryKind = z
  .enum(['expense', 'income'])
  .describe('`expense` (money out) or `income` (money in). Defaults to `expense`.');

/** An expense row as the server reports it. */
export const Expense = z.strictObject({
  ...SYNCABLE_SHAPE,
  categoryId: Uuid.describe(
    'Owning category. Always a live category of the same user; reassigned to the `Uncategorized` default if its category is deleted.',
  ),
  kind: EntryKind,
  amountMinor: AmountMinor,
  currency: CurrencyCode,
  date: CalendarDate,
  note: ExpenseNote.nullable(),
});

export const ExpenseCreateRequest = z.strictObject({
  id: Uuid.optional().describe(
    'Optional client-minted UUIDv7. Supply it so a row created offline keeps its identity; omit it and the server mints one.',
  ),
  categoryId: Uuid,
  kind: EntryKind.optional(),
  amountMinor: AmountMinor,
  currency: CurrencyCode.optional().describe(
    "Defaults to the user's currency when omitted. In the MVP it must equal it; anything else is a validation_error.",
  ),
  date: CalendarDate,
  note: ExpenseNoteInput.optional(),
});

export const ExpenseUpdateRequest = z
  .strictObject({
    categoryId: Uuid.optional(),
    kind: EntryKind.optional(),
    amountMinor: AmountMinor.optional(),
    currency: CurrencyCode.optional(),
    date: CalendarDate.optional(),
    note: ExpenseNoteInput.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'at least one field must be present' });

/**
 * Query for `GET /v1/expenses`. Keyset-paginated on `(date DESC, id DESC)`.
 *
 * Values arrive as strings on the query string, so numeric and boolean parameters are
 * coerced here — this is the one place in the contract where coercion is correct.
 */
export const ExpenseListQuery = z
  .strictObject({
    from: CalendarDate.optional().describe('Inclusive lower bound on `date` (YYYY-MM-DD).'),
    to: CalendarDate.optional().describe('Inclusive upper bound on `date` (YYYY-MM-DD).'),
    categoryId: Uuid.optional().describe('Restrict to one category.'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.EXPENSE_LIST_MAX_LIMIT)
      .optional()
      .describe('Page size, 1-200. Defaults to 50.'),
    cursor: OpaqueCursor.optional().describe(
      "Opaque cursor from the previous page's `nextCursor`. An undecodable value is `invalid_cursor`.",
    ),
    includeDeleted: z
      .stringbool()
      .optional()
      .describe('Include tombstoned expenses. Defaults to false. Mainly for debugging and tests.'),
  })
  /**
   * `to` must not be earlier than `from`.
   *
   * Both are `YYYY-MM-DD` and zero-padded, so a string comparison is a date comparison —
   * no parsing, and no timezone to get wrong. Declared here rather than in the handler so
   * the rule is part of the contract the client reads, instead of a server behaviour the
   * client discovers. A reversed range would otherwise return an empty page, which reads
   * as "no expenses that month" rather than "you swapped the bounds".
   */
  .refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
    error: '`to` must not be earlier than `from`',
    path: ['to'],
  });

export const ExpenseListResponse = z.strictObject({
  data: z
    .array(Expense)
    .describe('Page of expenses, newest `date` first, ties broken by `id` descending.'),
  nextCursor: OpaqueCursor.nullable().describe(
    'Cursor for the next page, or null on the last page.',
  ),
  hasMore: z
    .boolean()
    .describe('True when another page exists. Equivalent to `nextCursor !== null`.'),
});

export const ExpenseResponse = z.strictObject({
  data: Expense,
});

export type EntryKind = z.infer<typeof EntryKind>;
export type ExpenseNote = z.infer<typeof ExpenseNote>;
export type ExpenseNoteInput = z.infer<typeof ExpenseNoteInput>;
export type Expense = z.infer<typeof Expense>;
export type ExpenseCreateRequest = z.infer<typeof ExpenseCreateRequest>;
export type ExpenseUpdateRequest = z.infer<typeof ExpenseUpdateRequest>;
export type ExpenseListQuery = z.infer<typeof ExpenseListQuery>;
export type ExpenseListResponse = z.infer<typeof ExpenseListResponse>;
export type ExpenseResponse = z.infer<typeof ExpenseResponse>;
