import { parseBudgetInput } from '../categories/budgetInput';
import { COPY, VALIDATION_COPY } from '../copy/strings';
import type { NewGoal } from '../db/mutations';
import type { GoalListItem } from '../db/queries';
import { type CalendarDate, dateParts } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import { parseDateInput } from '../recurring/recurringModel';
import { GOAL_NAME_MAX } from '@expense-tracker/shared';

/**
 * A savings goal, judged as data: how far along it is, what the list reads aloud, and what
 * is wrong with the form. Pure and integer-only, like `summaryModel.ts`: a percentage is
 * integer division on minor units, and money is only formatted at the edge.
 */

export interface GoalProgress {
  /** 0..1 for the bar's width, clamped so an over-saved goal fills the bar and no more. */
  readonly fill: number;
  /** Whole percent saved, rounded down and capped at 100 - 99.9% is not "done". */
  readonly percent: number;
  readonly remainingMinor: number;
  readonly reached: boolean;
}

export function goalProgress(savedMinor: number, targetMinor: number): GoalProgress {
  const reached = savedMinor >= targetMinor;
  return {
    fill: targetMinor > 0 ? Math.min(1, Math.max(0, savedMinor / targetMinor)) : 0,
    percent: targetMinor > 0 ? Math.min(100, Math.floor((savedMinor * 100) / targetMinor)) : 0,
    remainingMinor: Math.max(0, targetMinor - savedMinor),
    reached,
  };
}

/** Whole months from `today` to `date`, at least 1 - what the monthly figure divides by. */
export function monthsUntil(today: CalendarDate, date: CalendarDate): number {
  const from = dateParts(today);
  const to = dateParts(date);
  const months = (to.year - from.year) * 12 + (to.month - from.month);
  // Part of a month still counts as one: saving for 10 days is a month's worth of saving.
  return Math.max(1, to.day > from.day ? months + 1 : months);
}

/**
 * What to put aside each month to reach the target by the deadline, or null when there is
 * nothing to say: no deadline, already reached, or the deadline has passed. Rounded up, so
 * following it never leaves the goal a few cents short.
 */
export function neededPerMonth(
  goal: Pick<GoalListItem, 'savedMinor' | 'targetMinor' | 'deadline'>,
  today: CalendarDate,
): number | null {
  if (goal.deadline === null || goal.deadline <= today) return null;
  const { remainingMinor, reached } = goalProgress(goal.savedMinor, goal.targetMinor);
  if (reached) return null;
  return Math.ceil(remainingMinor / monthsUntil(today, goal.deadline));
}

/** `$250.00 of $1,000.00`. */
export function goalAmounts(goal: GoalListItem, locale?: string): string {
  return COPY.goals.row.amounts
    .replace('{saved}', formatMoney(goal.savedMinor, goal.currency, locale))
    .replace('{target}', formatMoney(goal.targetMinor, goal.currency, locale));
}

/** The status line: reached, the monthly figure, a deadline, or nothing. */
export function goalStatus(
  goal: GoalListItem,
  today: CalendarDate,
  locale?: string,
): string | null {
  if (goalProgress(goal.savedMinor, goal.targetMinor).reached) return COPY.goals.row.reached;
  if (goal.deadline !== null && goal.deadline <= today) {
    return COPY.goals.row.pastDeadline.replace('{date}', goal.deadline);
  }
  const monthly = neededPerMonth(goal, today);
  if (monthly === null) return null;
  return COPY.goals.row.perMonth
    .replace('{amount}', formatMoney(monthly, goal.currency, locale))
    .replace('{date}', goal.deadline ?? '');
}

export interface GoalDraft {
  readonly name: string;
  readonly targetText: string;
  /** Edit mode only; empty on create. */
  readonly savedText: string;
  readonly deadlineText: string;
}

export interface GoalErrors {
  readonly name?: string;
  readonly target?: string;
  readonly saved?: string;
  readonly deadline?: string;
}

export type GoalValidation =
  | { readonly ok: true; readonly value: Omit<NewGoal, 'currency'> }
  | { readonly ok: false; readonly errors: GoalErrors };

/** Every problem at once, so a person fixing the form is not told one thing per tap. */
export function validateGoalDraft(draft: GoalDraft, decimals: number): GoalValidation {
  const errors: { name?: string; target?: string; saved?: string; deadline?: string } = {};

  const name = draft.name.trim();
  if (name === '') errors.name = COPY.goals.error.name;
  else if (name.length > GOAL_NAME_MAX) errors.name = COPY.goals.error.nameLong;

  const target = parseBudgetInput(draft.targetText, decimals);
  if (target.kind === 'none') errors.target = VALIDATION_COPY.amount.zero;
  else if (target.kind === 'invalid') {
    errors.target =
      target.reason === 'zero'
        ? VALIDATION_COPY.amount.zero
        : target.reason === 'max'
          ? VALIDATION_COPY.amount.max
          : COPY.goals.error.amount;
  }

  // Empty and zero both mean "nothing saved yet"; only a malformed or oversized value is wrong.
  let savedMinor = 0;
  if (draft.savedText.trim() !== '') {
    const saved = parseBudgetInput(draft.savedText, decimals);
    if (saved.kind === 'amount') savedMinor = saved.amountMinor;
    else if (saved.kind === 'invalid' && saved.reason !== 'zero') {
      errors.saved = saved.reason === 'max' ? VALIDATION_COPY.amount.max : COPY.goals.error.amount;
    }
  }

  let deadline: CalendarDate | null = null;
  if (draft.deadlineText.trim() !== '') {
    deadline = parseDateInput(draft.deadlineText);
    if (deadline === null) errors.deadline = COPY.goals.error.date;
  }

  if (Object.keys(errors).length > 0 || target.kind !== 'amount') {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, targetMinor: target.amountMinor, savedMinor, deadline } };
}

export type DepositValidation =
  | { readonly ok: true; readonly amountMinor: number }
  | { readonly ok: false; readonly error: string };

/** A deposit has to be a positive amount. */
export function validateDeposit(text: string, decimals: number): DepositValidation {
  const amount = parseBudgetInput(text, decimals);
  if (amount.kind === 'amount') return { ok: true, amountMinor: amount.amountMinor };
  if (amount.kind === 'none' || (amount.kind === 'invalid' && amount.reason === 'zero')) {
    return { ok: false, error: VALIDATION_COPY.amount.zero };
  }
  return {
    ok: false,
    error: amount.reason === 'max' ? VALIDATION_COPY.amount.max : COPY.goals.error.amount,
  };
}
