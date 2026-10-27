import type { MonthlyTotal } from '../db/queries';
import { stepMonth, type MonthKey } from '../lib/calendar';

/**
 * The Summary's trend, worked out as data before anything draws it.
 *
 * Like `summaryModel.ts`: pure, integer minor units, no division of money. The only ratio is
 * a bar's height, and that is a layout fraction, not an amount - nothing displayed is
 * derived from it.
 */

/** How many months the chart covers, ending at the selected one. */
export const TREND_MONTHS = 6;

export interface TrendBar {
  readonly month: MonthKey;
  readonly totalMinor: number;
  /** 0..1 of the tallest bar. 0 for an empty month, never negative. */
  readonly fraction: number;
  readonly selected: boolean;
}

export interface Trend {
  readonly bars: readonly TrendBar[];
  /** Months in the window holding any spend. The chart is only worth drawing from two. */
  readonly monthsWithSpend: number;
  readonly isWorthShowing: boolean;
}

/** Every month in the window, oldest first, gaps filled with zero. */
export function buildTrend(rows: readonly MonthlyTotal[], endMonth: MonthKey): Trend {
  const byMonth = new Map(rows.map((row) => [row.month, row.totalMinor]));
  const months = Array.from({ length: TREND_MONTHS }, (_, i) =>
    stepMonth(endMonth, i - (TREND_MONTHS - 1)),
  );
  // A negative total can only come from corrupt data; clamped so a bar never has negative height.
  const totals = months.map((month) => Math.max(0, byMonth.get(month) ?? 0));
  const tallest = Math.max(...totals);

  const bars = months.map((month, i) => ({
    month,
    totalMinor: totals[i]!,
    fraction: tallest > 0 ? totals[i]! / tallest : 0,
    selected: month === endMonth,
  }));
  const monthsWithSpend = totals.filter((total) => total > 0).length;
  return { bars, monthsWithSpend, isWorthShowing: monthsWithSpend >= 2 };
}
