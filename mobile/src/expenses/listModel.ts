import { UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import { COPY } from '../copy/strings';
import { CATEGORY_RESERVED_COLOR } from '../theme/tokens';
import { type CalendarDate, dayLabel } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import type { ExpenseListItem } from '../db/queries';

/**
 * The shape of the expense list, worked out as data before anything renders it.
 *
 * Grouping and label composition are here, as pure functions over the rows the query
 * returned, because both are specified precisely and both are the kind of thing that is
 * wrong in a way no screenshot reveals - a row filed under the wrong day, or a screen
 * reader hearing an amount without the day it belongs to. Testing them through a mounted
 * `SectionList` would mean asserting on rendered text to find out whether the arithmetic
 * was right.
 */

/** One day's worth of rows, as a `SectionList` section. */
export interface ExpenseSection {
  /** `Today` / `Yesterday` / `EEE d MMM` (`04-expense-list.md` rule 2). */
  readonly title: string;
  /** The raw `YYYY-MM-DD`, which is the stable key - two days can share a title never. */
  readonly date: CalendarDate;
  readonly data: readonly ExpenseListItem[];
}

/**
 * Group rows into day sections, newest day first.
 *
 * The rows arrive from SQLite already ordered `date DESC, id DESC`, so this walks them in
 * order and starts a section whenever the date changes. It does **not** sort, and that is
 * deliberate: re-sorting here would quietly take over the ordering contract from the query
 * - including the `id DESC` tiebreak that puts a just-added expense at the top of its day -
 * and the two could then disagree with nothing to say which was right.
 *
 * Grouping is on the raw `YYYY-MM-DD` string and never on a `Date`. An expense's `date` is
 * zone-less: "a row dated last Tuesday that was typed today belongs under last Tuesday"
 * (rule 1), and passing it through a local `Date` is what would move it a day.
 */
export function groupByDate(
  items: readonly ExpenseListItem[],
  today: CalendarDate,
  locale?: string,
): readonly ExpenseSection[] {
  const sections: { title: string; date: CalendarDate; data: ExpenseListItem[] }[] = [];

  for (const item of items) {
    const current = sections[sections.length - 1];
    if (current !== undefined && current.date === item.date) {
      current.data.push(item);
    } else {
      sections.push({ title: dayLabel(item.date, today, locale), date: item.date, data: [item] });
    }
  }

  return sections;
}

/**
 * The category name to show on a row.
 *
 * `categoryName` is null when the row's `categoryId` resolves to no live category, which
 * is reachable rather than defensive: a pull delivers rows by revision, so a category
 * tombstone can arrive before the reassignment that follows it (`db/queries.ts`,
 * `ExpenseListItem.categoryName`). The row renders under the fallback category for those
 * few seconds instead of rendering blank.
 *
 * The last resort is the contract's own seed name, for the case where even the fallback is
 * missing - a broken invariant that the delete path repairs. A row that is money the user
 * spent must render either way.
 */
export function rowCategoryName(item: ExpenseListItem): string {
  return item.categoryName ?? item.fallbackName ?? UNCATEGORIZED_NAME;
}

export function rowCategoryColor(item: ExpenseListItem): string {
  return item.categoryColor ?? item.fallbackColor ?? CATEGORY_RESERVED_COLOR;
}

/**
 * A row's composed accessibility label (§Accessibility rule 1).
 *
 * > `{category}, {formatted amount}, {note}, {date}` + `, not synced yet` when pending
 *
 * Two details worth not rounding off:
 *
 * - **The note is omitted when absent**, rather than read as an empty gap. The spec lists
 *   the parts "omitting absent parts".
 * - **The date is always included**, even though the row sits under a section header that
 *   says the same thing. Headers are easy to miss when swiping element to element, and a
 *   row read without its date is ambiguous - which is exactly the ambiguity that makes
 *   someone check the wrong month's spending.
 */
/**
 * What was actually paid, in its own currency (`€10.00`), or null for an ordinary expense.
 * The row's amount is always the account-currency one the totals use; this is the receipt.
 */
export function originalLabel(item: ExpenseListItem, locale?: string): string | null {
  if (item.originalAmountMinor === null || item.originalCurrency === null) return null;
  return formatMoney(item.originalAmountMinor, item.originalCurrency, locale);
}

export function expenseRowLabel(
  item: ExpenseListItem,
  today: CalendarDate,
  locale?: string,
  /** "Added by Bao", in a shared household. */
  addedBy?: string | null,
): string {
  const parts = [
    rowCategoryName(item),
    ...(item.kind === 'income' ? [COPY.home.incomeLabel] : []),
    formatMoney(item.amountMinor, item.currency, locale),
    ...(originalLabel(item, locale) === null
      ? []
      : [COPY.home.paidIn.replace('{amount}', originalLabel(item, locale) ?? '')]),
    ...(item.note === null || item.note.trim().length === 0 ? [] : [item.note]),
    ...(addedBy === null || addedBy === undefined ? [] : [addedBy]),
    dayLabel(item.date, today, locale),
    ...(item.private ? [COPY.a11y.private] : []),
    ...(item.pending ? [COPY.a11y.notSyncedYet] : []),
    // Deck §8: the row's composed label ends with `, could not sync` when the server
    // refused it. Appended rather than substituted, because the amount and the day are
    // still what the row is about.
    ...(item.needsAttention ? [COPY.a11y.couldNotSync] : []),
  ];

  return parts.join(', ');
}
