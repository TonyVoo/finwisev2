import {
  defaultCategories,
  type ReceiptCategoryKey,
  type ReceiptScan,
} from '@expense-tracker/shared';
import { formatMoney } from '../lib/money';

/**
 * What a receipt reading may do to the form (`docs/design/11-receipt-scan.md`).
 *
 * The reading is a suggestion, and tapping Use is the person's own act - but even then some
 * values are only safe in some situations, and those rules live here, as plain functions, so
 * the form just applies what comes back: never overwrite a note someone wrote, never put an
 * amount read in the account's decimals into a currency with different ones, and never point
 * at a category the person does not have.
 */

/** The English default name behind each reading key; the Vietnamese one is found by position. */
const DEFAULT_NAME: Readonly<Record<ReceiptCategoryKey, string>> = {
  groceries: 'Groceries',
  eating_out: 'Eating out',
  transport: 'Transport',
  health: 'Health',
  bills: 'Bills',
};

function normalise(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** The id of the person's category for a reading's key, or null when they do not have one. */
export function matchCategory(
  key: ReceiptCategoryKey | null,
  categories: readonly { readonly id: string; readonly name: string }[],
): string | null {
  if (key === null) return null;
  const english = defaultCategories('en');
  const position = english.findIndex((category) => category.name === DEFAULT_NAME[key]);
  const names = [DEFAULT_NAME[key], defaultCategories('vi')[position]?.name ?? DEFAULT_NAME[key]];
  const wanted = new Set(names.map(normalise));
  return categories.find((category) => wanted.has(normalise(category.name)))?.id ?? null;
}

export interface SuggestionPatch {
  readonly amountMinor?: number;
  readonly date?: string;
  readonly note?: string;
  readonly categoryId?: string;
}

export interface SuggestionContext {
  /** What the note holds now. */
  readonly currentNote: string | null;
  /** True when the form's entry currency has the same decimals as the account's. */
  readonly decimalsMatch: boolean;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  /** The form's today: a receipt cannot be from after it. */
  readonly today: string;
}

/** The values from a reading that are safe to put into the form right now. */
export function planSuggestion(scan: ReceiptScan, context: SuggestionContext): SuggestionPatch {
  const categoryId = matchCategory(scan.category, context.categories);
  const noteIsEmpty = context.currentNote === null || context.currentNote.trim() === '';
  return {
    ...(scan.amountMinor !== null && context.decimalsMatch
      ? { amountMinor: scan.amountMinor }
      : {}),
    ...(scan.date !== null && scan.date <= context.today ? { date: scan.date } : {}),
    ...(scan.merchant !== null && noteIsEmpty ? { note: scan.merchant } : {}),
    ...(categoryId !== null ? { categoryId } : {}),
  };
}

/** True when the reading found nothing at all, so there is nothing to offer. */
export function isEmptyScan(scan: ReceiptScan): boolean {
  return (
    scan.amountMinor === null &&
    scan.date === null &&
    scan.merchant === null &&
    scan.category === null
  );
}

/** One line for the suggestion card: what was found, amount first. */
export function suggestionSummary(scan: ReceiptScan, formatDate: (date: string) => string): string {
  return [
    scan.amountMinor === null ? null : formatMoney(scan.amountMinor, scan.currency),
    scan.date === null ? null : formatDate(scan.date),
    scan.merchant,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
