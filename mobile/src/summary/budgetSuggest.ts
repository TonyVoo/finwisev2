/**
 * Suggested budgets, worked out from what the person actually spent.
 *
 * For each category with a few months of history, a monthly limit a little above its typical month (so a usual month
 * fits), rounded up to a figure that reads like a limit someone would set. And one for the whole month, from the
 * month totals. Pure and integer-only: nothing here asks the person for anything or changes a budget; applying a
 * suggestion is their tap, on the card that shows it.
 */

export interface CategoryHistory {
  readonly categoryId: string;
  readonly name: string;
  /** Spend in each of the last full months, minor units, zero for a month with none. */
  readonly months: readonly number[];
  /** The category's budget now, or null for none. */
  readonly currentMinor: number | null;
}

export type SuggestionChange = 'new' | 'raise' | 'lower';

export interface BudgetSuggestion {
  readonly categoryId: string;
  readonly name: string;
  readonly averageMinor: number;
  readonly suggestedMinor: number;
  readonly currentMinor: number | null;
  readonly change: SuggestionChange;
}

/** Months of history a suggestion needs: one month is an event, two is the start of a habit. */
export const MIN_MONTHS = 2;
/** A suggestion that would move a budget by this much or less is not worth the person's attention. */
const MEANINGFUL_NUMERATOR = 1;
const MEANINGFUL_DENOMINATOR = 10;
/** Headroom over the typical month, as a fraction: 5%. */
const HEADROOM_NUMERATOR = 21;
const HEADROOM_DENOMINATOR = 20;

/** The smallest number at or above `value` that has at most two significant digits: 3.170.000 -> 3.200.000. */
export function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const digits = Math.floor(Math.log10(value));
  if (digits < 1) return Math.ceil(value);
  const unit = 10 ** (digits - 1);
  return Math.ceil(value / unit) * unit;
}

function averageOfSpent(months: readonly number[]): number | null {
  const spent = months.filter((m) => m > 0);
  if (spent.length < MIN_MONTHS) return null;
  return Math.round(spent.reduce((sum, m) => sum + m, 0) / spent.length);
}

function suggestedFrom(average: number): number {
  return niceCeil(Math.ceil((average * HEADROOM_NUMERATOR) / HEADROOM_DENOMINATOR));
}

/** Within a tenth of the current figure: the same budget, as far as the person is concerned. */
function nearlySame(suggested: number, current: number): boolean {
  return Math.abs(suggested - current) * MEANINGFUL_DENOMINATOR <= current * MEANINGFUL_NUMERATOR;
}

export function suggestBudgets(rows: readonly CategoryHistory[]): readonly BudgetSuggestion[] {
  const out: BudgetSuggestion[] = [];
  for (const row of rows) {
    const average = averageOfSpent(row.months);
    if (average === null) continue;
    const suggested = suggestedFrom(average);
    if (suggested <= 0) continue;
    if (row.currentMinor !== null && nearlySame(suggested, row.currentMinor)) continue;
    out.push({
      categoryId: row.categoryId,
      name: row.name,
      averageMinor: average,
      suggestedMinor: suggested,
      currentMinor: row.currentMinor,
      change: row.currentMinor === null ? 'new' : suggested > row.currentMinor ? 'raise' : 'lower',
    });
  }
  return out.sort((a, b) => b.suggestedMinor - a.suggestedMinor);
}

/** A limit for the whole month from the months' totals, or null with too little history or no real change. */
export function suggestLimit(
  monthTotals: readonly number[],
  currentMinor: number | null,
): number | null {
  const average = averageOfSpent(monthTotals);
  if (average === null) return null;
  const suggested = suggestedFrom(average);
  if (suggested <= 0) return null;
  if (currentMinor !== null && nearlySame(suggested, currentMinor)) return null;
  return suggested;
}
