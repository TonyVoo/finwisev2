import { type CalendarDate, dateParts, daysInMonth, monthKey } from '../lib/calendar';
import { parseBudgetInput } from '../categories/budgetInput';
import { formatMoney } from '../lib/money';
import { COPY, VALIDATION_COPY } from '../copy/strings';
import type { NewRecurring } from '../db/mutations';
import type { RecurringListItem } from '../db/queries';
import { nextOccurrence } from './schedule';

/**
 * The recurring form, judged as data: what the fields say, what is wrong with them, and
 * what the list reads aloud. Pure, so the rules - which are the part a screenshot cannot
 * show - are tested without mounting a sheet.
 */

/** A strictly valid `YYYY-MM-DD`, or null. `2026-02-30` is not a date and is not accepted. */
export function parseDateInput(text: string): CalendarDate | null {
  const trimmed = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const { year, month, day } = dateParts(trimmed);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return null;
  return day <= daysInMonth(monthKey(year, month)) ? trimmed : null;
}

export interface RecurringDraft {
  readonly categoryId: string | null;
  readonly amountText: string;
  readonly note: string;
  readonly frequency: 'weekly' | 'monthly';
  readonly startText: string;
  readonly endText: string;
}

export interface RecurringErrors {
  readonly category?: string;
  readonly amount?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

export type RecurringValidation =
  | { readonly ok: true; readonly value: Omit<NewRecurring, 'currency'> }
  | { readonly ok: false; readonly errors: RecurringErrors };

/** Every problem at once, so a person fixing the form is not told one thing per tap. */
export function validateRecurringDraft(
  draft: RecurringDraft,
  decimals: number,
): RecurringValidation {
  const errors: {
    category?: string;
    amount?: string;
    startDate?: string;
    endDate?: string;
  } = {};

  if (draft.categoryId === null) errors.category = COPY.recurring.error.noCategory;

  const amount = parseBudgetInput(draft.amountText, decimals);
  if (amount.kind === 'none') errors.amount = VALIDATION_COPY.amount.zero;
  else if (amount.kind === 'invalid') {
    errors.amount =
      amount.reason === 'zero'
        ? VALIDATION_COPY.amount.zero
        : amount.reason === 'max'
          ? VALIDATION_COPY.amount.max
          : COPY.recurring.error.amount;
  }

  const start = parseDateInput(draft.startText);
  if (start === null) errors.startDate = COPY.recurring.error.date;

  let end: CalendarDate | null = null;
  if (draft.endText.trim() !== '') {
    end = parseDateInput(draft.endText);
    if (end === null) errors.endDate = COPY.recurring.error.date;
    else if (start !== null && end < start) errors.endDate = COPY.recurring.error.endBeforeStart;
  }

  if (
    Object.keys(errors).length > 0 ||
    draft.categoryId === null ||
    amount.kind !== 'amount' ||
    start === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      categoryId: draft.categoryId,
      amountMinor: amount.amountMinor,
      note: draft.note.trim() === '' ? null : draft.note.trim(),
      frequency: draft.frequency,
      startDate: start,
      endDate: end,
    },
  };
}

/** The row's title: the note when there is one, otherwise the category it files under. */
export function recurringTitle(item: RecurringListItem, fallbackName: string): string {
  return item.note ?? item.categoryName ?? fallbackName;
}

/** `$12.99 · Monthly`. */
export function recurringSummary(item: RecurringListItem, locale?: string): string {
  const frequency = COPY.recurring.frequency[item.frequency];
  return `${formatMoney(item.amountMinor, item.currency, locale)} · ${frequency}`;
}

/** `Next 2026-11-05`, or `Ended` once the last occurrence has passed. */
export function recurringNextLabel(item: RecurringListItem, today: CalendarDate): string {
  const next = nextOccurrence(item, today);
  return next === null ? COPY.recurring.row.ended : COPY.recurring.row.next.replace('{date}', next);
}
