import { z } from 'zod';
import { AmountMinor, CalendarDate, Timestamp, Uuid } from './primitives.js';
import { SYNCABLE_SHAPE } from './syncable.js';

/**
 * A recorded payment between two members of a household: "Bao paid Ana 42.00"
 * (`docs/design/12-settle-up.md`).
 *
 * It is how a balance is brought back towards zero: balances are the household's expenses minus
 * these payments, computed on each device. A settlement lives in the household's book like every
 * other shared row, so every member sees every payment, and it is sync-only like goals: there is no
 * REST route, a change travels as a push item and arrives as a pull change.
 *
 * Either person it names may record it, edit it or delete it; deleting is the way to undo one. Both
 * must be current members when it is written, but no foreign key holds them, so a member leaving
 * later leaves the history intact. There is no currency: the amount is in the household's.
 */

export const SETTLEMENT_NOTE_MAX = 200;

export const SettlementNote = z
  .string()
  .trim()
  .max(SETTLEMENT_NOTE_MAX)
  .describe('Free-text note, up to 200 characters after trimming.');

/** A note as a client sends it: trimmed, with one that trims to nothing as `null`. */
export const SettlementNoteInput = SettlementNote.nullable().transform((value) =>
  value === '' ? null : value,
);

export const SettlementAmount = AmountMinor.min(1).describe(
  'Amount paid, in minor units of the household currency. Greater than zero.',
);

/** A settlement as the server reports it. */
export const Settlement = z.strictObject({
  ...SYNCABLE_SHAPE,
  fromUserId: Uuid.describe('Who paid.'),
  toUserId: Uuid.describe('Who was paid. Never the same as `fromUserId`.'),
  amountMinor: SettlementAmount,
  date: CalendarDate.describe('The day the payment happened.'),
  note: SettlementNote.nullable(),
  createdBy: Uuid.nullable().describe(
    'Who recorded it: one of the two people it names. Server-assigned and immutable.',
  ),
});

/**
 * Mutable fields of a settlement in a sync push. Upsert-with-merge, like the other entities;
 * `fromUserId`, `toUserId`, `amountMinor` and `date` are all required to create one.
 */
export const SettlementSyncFields = z
  .strictObject({
    fromUserId: Uuid.optional(),
    toUserId: Uuid.optional(),
    amountMinor: SettlementAmount.optional(),
    date: CalendarDate.optional(),
    note: SettlementNoteInput.optional(),
    deletedAt: Timestamp.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'fields must not be empty' });

export type Settlement = z.infer<typeof Settlement>;
export type SettlementSyncFields = z.infer<typeof SettlementSyncFields>;
