import type {
  CalendarDate,
  Category as WireCategory,
  Expense as WireExpense,
  Goal as WireGoal,
  RecurringRule as WireRecurringRule,
  User as WireUser,
} from '@expense-tracker/shared';
import type {
  Category as CategoryRow,
  Expense as ExpenseRow,
  Goal as GoalRow,
  RecurringRule as RecurringRuleRow,
  User as UserRow,
} from './generated/client.ts';

/**
 * Row → wire mappers.
 *
 * Every response body is built through one of these rather than by spreading a Prisma
 * row, because a spread is how `passwordHash` ends up on the wire. These pick fields
 * explicitly, so adding a column to the database cannot leak it, and
 * `sendJson`'s schema check catches the reverse mistake of forgetting one.
 */

export function toWireUser(row: UserRow): WireUser {
  return {
    id: row.id,
    email: row.email,
    currency: row.currency,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWireCategory(row: CategoryRow): WireCategory {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.isDefault,
    monthlyBudgetMinor: row.monthlyBudgetMinor === null ? null : Number(row.monthlyBudgetMinor),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    revision: row.revision,
  };
}

/**
 * Format a Postgres `DATE` as the contract's zone-less `YYYY-MM-DD`.
 *
 * The driver hands a `DATE` back as a JS `Date` pinned to UTC midnight, so the
 * calendar fields must be read in UTC. `toLocaleDateString()`, or anything that goes
 * through the local zone, shifts `2026-10-06` to `2026-10-05` for every server west of
 * Greenwich — which is the exact timezone bug the column type was chosen to prevent.
 */
export function toCalendarDate(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

/** Parse the contract's `YYYY-MM-DD` into the UTC-midnight instant a `DATE` stores. */
export function fromCalendarDate(date: CalendarDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function toWireExpense(row: ExpenseRow): WireExpense {
  return {
    id: row.id,
    categoryId: row.categoryId,
    kind: row.kind as WireExpense['kind'],
    // `amount_minor` is `bigint` in Postgres because the contract's maximum overflows
    // `int4`. It is still exact as a JS number (well under 2^53), and the wire type is
    // an integer, so the narrowing happens here, once, at the boundary.
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    originalAmountMinor: row.originalAmountMinor === null ? null : Number(row.originalAmountMinor),
    originalCurrency: row.originalCurrency,
    createdBy: row.createdBy,
    date: toCalendarDate(row.date),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    revision: row.revision,
  };
}

export function toWireRecurringRule(row: RecurringRuleRow): WireRecurringRule {
  return {
    id: row.id,
    categoryId: row.categoryId,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    note: row.note,
    // Held by a CHECK constraint, so the cast narrows what the database already guarantees.
    frequency: row.frequency as WireRecurringRule['frequency'],
    startDate: toCalendarDate(row.startDate),
    endDate: row.endDate === null ? null : toCalendarDate(row.endDate),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    revision: row.revision,
  };
}

export function toWireGoal(row: GoalRow): WireGoal {
  return {
    id: row.id,
    name: row.name,
    targetMinor: Number(row.targetMinor),
    savedMinor: Number(row.savedMinor),
    currency: row.currency,
    deadline: row.deadline === null ? null : toCalendarDate(row.deadline),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    revision: row.revision,
  };
}
