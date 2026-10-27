import { z } from 'zod';
import { AmountMinor, CalendarDate, CurrencyCode, Timestamp } from './primitives.js';
import { SYNCABLE_SHAPE } from './syncable.js';

/**
 * A savings goal: a target amount, how much has been put towards it, and an optional date.
 *
 * Progress is **manual**: the person records a deposit and the device writes the new
 * `savedMinor`. It is deliberately not derived from income and spending, which would make
 * a goal's progress move with every purchase and say nothing about where the money is kept.
 *
 * `savedMinor` is one field two devices can both write, so concurrent deposits resolve by
 * last-write-wins like every other field: the later total replaces the earlier one. A
 * deposit is not an increment on the wire.
 */

export const GOAL_NAME_MAX = 60;

export const GoalName = z
  .string()
  .trim()
  .min(1)
  .max(GOAL_NAME_MAX)
  .describe('Display name, 1-60 characters after trimming.');

export const GoalTarget = AmountMinor.min(1).describe('Target in minor units. Greater than zero.');

/** A goal as the server reports it. */
export const Goal = z.strictObject({
  ...SYNCABLE_SHAPE,
  name: GoalName,
  targetMinor: GoalTarget,
  savedMinor: AmountMinor.describe('Amount put towards the goal so far. May exceed the target.'),
  currency: CurrencyCode,
  deadline: CalendarDate.nullable().describe('Day the person wants to have reached the goal by.'),
});

/** Mutable fields of a goal in a sync push. Upsert-with-merge, like the other entities. */
export const GoalSyncFields = z
  .strictObject({
    name: GoalName.optional(),
    targetMinor: GoalTarget.optional(),
    savedMinor: AmountMinor.optional(),
    currency: CurrencyCode.optional(),
    deadline: CalendarDate.nullable().optional(),
    deletedAt: Timestamp.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'fields must not be empty' });

export type GoalName = z.infer<typeof GoalName>;
export type Goal = z.infer<typeof Goal>;
export type GoalSyncFields = z.infer<typeof GoalSyncFields>;
