import { formatMoney } from '../lib/money';
import type { QuickAddReading } from './parseQuickAdd';

/**
 * What a quick-add reading may do to the form (`docs/design/15-quick-add.md`): the receipt rules
 * (`docs/design/11-receipt-scan.md`) plus the type. Tapping Use is the person's own act, but even then a
 * value is only applied where it is safe, and those rules are here, as plain functions, so the form
 * just applies what comes back.
 */

export interface QuickAddPatch {
  readonly type?: 'expense' | 'income';
  readonly amountMinor?: number;
  readonly date?: string;
  readonly note?: string;
  readonly categoryId?: string;
}

export interface QuickAddPlanContext {
  /** What the note holds now. */
  readonly currentNote: string | null;
  /** True when the form's entry currency has the same decimals as the account's. */
  readonly decimalsMatch: boolean;
  /** The form's today: nothing can have happened after it. */
  readonly today: string;
  /** True while the form is untouched, so changing expense to income cannot surprise anyone. */
  readonly canSetType: boolean;
}

export function isEmptyReading(reading: QuickAddReading): boolean {
  return (
    reading.type === 'expense' &&
    reading.amountMinor === null &&
    reading.date === null &&
    reading.note === null &&
    reading.categoryId === null
  );
}

/** The values from a reading that are safe to put into the form right now. */
export function planQuickAdd(
  reading: QuickAddReading,
  context: QuickAddPlanContext,
): QuickAddPatch {
  if (isEmptyReading(reading)) return {};
  const noteIsEmpty = context.currentNote === null || context.currentNote.trim() === '';
  return {
    ...(context.canSetType ? { type: reading.type } : {}),
    ...(reading.amountMinor !== null && context.decimalsMatch
      ? { amountMinor: reading.amountMinor }
      : {}),
    ...(reading.date !== null && reading.date <= context.today ? { date: reading.date } : {}),
    ...(reading.note !== null && noteIsEmpty ? { note: reading.note } : {}),
    ...(reading.categoryId !== null ? { categoryId: reading.categoryId } : {}),
  };
}

/** One line for the suggestion card: what was found, amount first. */
export function quickAddSummary(
  reading: QuickAddReading,
  currency: string,
  formatDate: (date: string) => string,
): string {
  return [
    reading.amountMinor === null ? null : formatMoney(reading.amountMinor, currency),
    reading.date === null ? null : formatDate(reading.date),
    reading.note,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
