import { UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import type { CategorySpend } from '../db/queries';
import { formatMoney } from '../lib/money';
import { CATEGORY_RESERVED_COLOR } from '../theme/tokens';

/**
 * The Summary screen, worked out as data before anything draws it.
 *
 * `docs/design/08-monthly-summary.md` §Behaviour rule 1: the total, the chart, the legend
 * and the count "are the same data, aggregated once". That aggregate is
 * `monthCategorySpend` in `db/queries.ts`; everything below is derived from its rows and
 * nothing here goes back to the database. So the four figures on screen cannot disagree,
 * and the arithmetic that decides them - which is the part that is wrong in a way no
 * screenshot reveals - is testable without mounting a chart.
 *
 * **Nothing here divides money.** Percentages are integer arithmetic on minor units and
 * the only formatting is at the edge, in {@link formatMoney} (rule 3, and `docs/PLAN.md`
 * §Data model).
 */

/** One legend row, and one slice: the same entry, read twice (rule 6). */
export interface SpendEntry {
  readonly categoryId: string | null;
  /** Resolved for display: the contract's seed name is the last resort (`listModel.ts`). */
  readonly name: string;
  readonly color: string;
  readonly totalMinor: number;
  readonly expenseCount: number;
  /**
   * The exact ratio of the month, for the slice angle - never the rounded percentage, so
   * the geometry stays true where the label is rounded (rule 3).
   *
   * Null when the month total is zero, which is the one case there is no ratio to take.
   */
  readonly share: number | null;
  /** `40%`, or `<1%` for a non-zero amount that rounds below one (rule 3). Null as above. */
  readonly percentLabel: string | null;
}

export interface MonthSummary {
  /** The month's total in minor units: the sum of the groups, so it matches Home's. */
  readonly totalMinor: number;
  /** Live expenses in the month, zero-amount ones included. */
  readonly expenseCount: number;
  /** Legend rows, amount descending, ties broken by name - the order slices are drawn in. */
  readonly entries: readonly SpendEntry[];
  /**
   * Whether the month holds any expense at all. **Not** `totalMinor > 0`: a month of
   * zero-amount expenses totals nothing and is still not empty (`SUM-18`), and the spec's
   * rule 11 conflates the two.
   */
  readonly hasExpenses: boolean;
  /**
   * Whether to draw the donut (rule 11). The guard against dividing by zero in the
   * percentages, and the reason {@link SpendEntry.share} can be null: an empty ring reads
   * as a loading state or a bug, so a zero-value donut is never drawn.
   */
  readonly isChartable: boolean;
}

/**
 * Turn the aggregate's rows into the screen.
 *
 * The rows arrive ordered by the query (amount descending, ties on name, case-insensitive)
 * and this does **not** re-sort them. Re-sorting here would quietly take the ordering
 * contract off the query, and the two could then disagree with nothing to say which was
 * right - the same reasoning as `groupByDate` in `listModel.ts`.
 */
export function summariseMonth(rows: readonly CategorySpend[]): MonthSummary {
  const totalMinor = rows.reduce((total, row) => total + row.totalMinor, 0);
  const expenseCount = rows.reduce((count, row) => count + row.expenseCount, 0);

  // A category with no spend is excluded from both the chart and the legend: a 0% slice is
  // invisible and a `$0.00 / 0%` row is noise (state `empty` - a category with zero spend).
  //
  // Unless the *month* sums to zero, in which case excluding them would leave the legend
  // empty and the screen would be a blank panel between the total and the tab bar, in a
  // state that is not `empty` because the expenses exist (`TVO-31` item 4). The rows stay,
  // with no percentage to show.
  const visible = totalMinor === 0 ? rows : rows.filter((row) => row.totalMinor !== 0);

  return {
    totalMinor,
    expenseCount,
    entries: visible.map((row) => toEntry(row, totalMinor)),
    // Counted over every group, not the visible ones: the header says how many expenses
    // the month holds, which is the figure Home's list shows, and a zero-amount expense is
    // still an expense even where it has no legend row.
    hasExpenses: expenseCount > 0,
    isChartable: totalMinor > 0,
  };
}

function toEntry(row: CategorySpend, totalMinor: number): SpendEntry {
  return {
    categoryId: row.categoryId,
    // Both fall back the way a list row does. Null means the category is gone *and* there
    // is no live fallback to fold into - a broken invariant - and the amount is still money
    // the user spent, so it renders rather than vanishing (`db/queries.ts`).
    name: row.name ?? UNCATEGORIZED_NAME,
    color: row.color ?? CATEGORY_RESERVED_COLOR,
    totalMinor: row.totalMinor,
    expenseCount: row.expenseCount,
    share: totalMinor === 0 ? null : row.totalMinor / totalMinor,
    percentLabel: totalMinor === 0 ? null : percentLabel(row.totalMinor, totalMinor),
  };
}

/**
 * `round(categoryTotal * 100 / monthTotal)`, as rule 3 writes it, with the one case that
 * rule singles out: **a non-zero amount never displays as `0%`**. It shows `<1%` instead,
 * because an amount beside `0%` reads as a bug in the arithmetic.
 *
 * Multiplying before dividing keeps it exact: both operands are integers and the product of
 * the largest amount the contract allows and 100 is still well inside
 * `Number.MAX_SAFE_INTEGER`.
 *
 * Displayed percentages may not sum to exactly 100%, which is expected of independent
 * rounding. The screen does not correct it by adjusting the largest slice - that would make
 * a legend row disagree with its own arithmetic - and no "100%" is displayed anywhere, so
 * no visible contradiction arises (rule 3).
 */
function percentLabel(amountMinor: number, totalMinor: number): string {
  const rounded = Math.round((amountMinor * 100) / totalMinor);
  if (rounded === 0 && amountMinor !== 0) return LESS_THAN_ONE_PERCENT;
  return `${rounded}%`;
}

const LESS_THAN_ONE_PERCENT = '<1%';

/**
 * A legend row's composed accessibility label (§Accessibility rule 2, deck §8):
 *
 * > `{name}, {formatted amount}, {percent} percent of the month`
 *
 * and `less than 1 percent of the month` for the `<1%` case. The amount is the *formatted*
 * string, which both VoiceOver and TalkBack read as currency - a screen reader must never
 * reach the raw `amountMinor`, which it would read as a plain five-digit number.
 *
 * The percentage is omitted, with its separator, when there is none to state: a month that
 * sums to zero has no shares. Absent parts being dropped is the deck's own rule for these
 * compositions (§8).
 */
export function legendRowLabel(entry: SpendEntry, currency: string, locale?: string): string {
  const parts = [entry.name, formatMoney(entry.totalMinor, currency, locale)];
  if (entry.percentLabel !== null) parts.push(spokenShare(entry.percentLabel));
  return parts.join(', ');
}

function spokenShare(percentLabel: string): string {
  if (percentLabel === LESS_THAN_ONE_PERCENT) return 'less than 1 percent of the month';
  // `40%` read as "40 percent of the month". The digits are spoken from the label itself,
  // so the two can never state different numbers.
  return `${percentLabel.replace('%', '')} percent of the month`;
}
