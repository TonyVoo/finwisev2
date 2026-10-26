import { z } from 'zod';
import { AmountMinor, CalendarDate, CurrencyCode, Timestamp, Uuid } from './primitives.js';
import { ExpenseNote, ExpenseNoteInput } from './expense.js';
import { SYNCABLE_SHAPE } from './syncable.js';

/**
 * A recurring expense: a rule that says "this much, in this category, every week/month".
 *
 * ### The rule never stores "what comes next"
 *
 * There is no `nextDate`. Every occurrence is a pure function of the rule - `startDate`
 * and `frequency` - so two devices that both know the rule agree on every date it has ever
 * produced without having to agree on a cursor. A stored cursor would be a field both
 * devices write to, and two devices writing the same field is exactly where
 * last-write-wins loses data.
 *
 * - `weekly`: `startDate`, then every 7 days.
 * - `monthly`: the day-of-month of `startDate` in each following month, **clamped to the
 *   month's length** (a rule starting on the 31st lands on the 28th/29th in February and
 *   the 30th in April, and goes back to the 31st in May - it does not drift).
 *
 * ### Who creates the expenses
 *
 * The device does, not the server: expenses are created offline like any other, so a rule
 * has to work with no connection. Each generated expense gets a deterministic id derived
 * from (rule id, occurrence date), so two devices generating the same occurrence produce
 * the *same row* and sync converges instead of duplicating it. That derivation is a
 * client concern and is deliberately not part of this contract: the server accepts any
 * UUID as an expense id.
 */

export const RECURRING_FREQUENCIES = ['weekly', 'monthly'] as const;

export const RecurringFrequency = z
  .enum(RECURRING_FREQUENCIES)
  .describe(
    '`weekly`: every 7 days from `startDate`. `monthly`: the same day of the month as `startDate`, clamped to the length of shorter months.',
  );

/** A recurring rule as the server reports it. */
export const RecurringRule = z.strictObject({
  ...SYNCABLE_SHAPE,
  categoryId: Uuid.describe(
    'Category the generated expenses are filed under. Unlike an expense, a rule is not reassigned when its category is deleted: it keeps the id, and the device files the expenses under the `Uncategorized` default instead.',
  ),
  amountMinor: AmountMinor,
  currency: CurrencyCode,
  note: ExpenseNote.nullable(),
  frequency: RecurringFrequency,
  startDate: CalendarDate.describe(
    'First occurrence, and the anchor every later one is computed from. May be in the past, in which case the missed occurrences are generated.',
  ),
  endDate: CalendarDate.nullable().describe(
    'Last day an occurrence may fall on, inclusive. `null` repeats until the rule is deleted. Never earlier than `startDate`.',
  ),
});

/** Mutable fields of a rule in a sync push. Upsert-with-merge, like the other entities. */
export const RecurringSyncFields = z
  .strictObject({
    categoryId: Uuid.optional(),
    amountMinor: AmountMinor.optional(),
    currency: CurrencyCode.optional(),
    note: ExpenseNoteInput.optional(),
    frequency: RecurringFrequency.optional(),
    startDate: CalendarDate.optional(),
    endDate: CalendarDate.nullable().optional(),
    deletedAt: Timestamp.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'fields must not be empty' });

export type RecurringFrequency = z.infer<typeof RecurringFrequency>;
export type RecurringRule = z.infer<typeof RecurringRule>;
export type RecurringSyncFields = z.infer<typeof RecurringSyncFields>;
