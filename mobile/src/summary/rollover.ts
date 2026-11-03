import type { CategorySpend } from '../db/queries';

/**
 * Budget rollover (`docs/design/22-budget-rollover.md`): what a category did not spend of its budget last month
 * is added to this month's. A device setting, off by default, applied to every category that has a budget.
 *
 * The rule, oldest month first (from the first month the category was spent in): `available = budget + carry`, `carry = max(0, available - spent)`. An overspend
 * carries nothing - a month over budget never makes the next one smaller - and nothing older than
 * {@link ROLLOVER_MONTHS} months is looked at. The category's *current* budget is used for every month, since only
 * the current one is stored. All integers.
 */

export const ROLLOVER_MONTHS = 6;

/** `earlier` is the previous months' rows, oldest first. Returns `current` with each budget raised by its carry. */
export function rolloverBudgets(
  current: readonly CategorySpend[],
  earlier: readonly (readonly CategorySpend[])[],
): readonly CategorySpend[] {
  return current.map((row) => {
    const budget = row.monthlyBudgetMinor;
    if (budget === null || row.categoryId === null) return row;

    let carry = 0;
    let started = false;
    for (const month of earlier) {
      const spent = month.find((r) => r.categoryId === row.categoryId)?.totalMinor;
      // The chain begins at the first month this category was spent in: before that there was nothing to
      // budget against (the budget may have been set last week), and counting those months would hand a new
      // budget six months of "unspent" money.
      if (spent !== undefined) started = true;
      if (started) carry = Math.max(0, budget + carry - (spent ?? 0));
    }
    return carry === 0 ? row : { ...row, monthlyBudgetMinor: budget + carry, carriedMinor: carry };
  });
}
