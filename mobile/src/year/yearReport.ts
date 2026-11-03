import { UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import type { CategorySpend, MonthlyTotal } from '../db/queries';

/**
 * The year in review (`docs/design/24-year-report.md`): twelve months of spend, the share of each category, and what
 * changed from the year before. Pure and in integers; the reads are the same monthly/category aggregates the
 * Summary uses, over a year instead of a month.
 */

export interface YearMonth {
  readonly month: string;
  readonly totalMinor: number;
}

export interface YearCategory {
  readonly id: string | null;
  readonly name: string;
  readonly color: string;
  readonly totalMinor: number;
  /** 0..1 of the year's spending. */
  readonly share: number;
  readonly previousMinor: number;
  /** This year minus last year, in this category. */
  readonly deltaMinor: number;
}

export interface YearReport {
  readonly year: number;
  readonly isEmpty: boolean;
  readonly totalMinor: number;
  readonly incomeMinor: number;
  /** Income minus spending (negative when more was spent than came in). */
  readonly savedMinor: number;
  readonly months: readonly YearMonth[];
  /** The dearest and the cheapest month among those with any spending. */
  readonly peak: YearMonth | null;
  readonly lowest: YearMonth | null;
  /** Spending per month, over the months that have happened (all twelve in a past year). */
  readonly averageMinor: number;
  readonly categories: readonly YearCategory[];
  readonly previousTotalMinor: number;
  readonly deltaMinor: number;
  /** The category that grew the most / fell the most against last year, when there is anything to compare. */
  readonly biggestRise: YearCategory | null;
  readonly biggestFall: YearCategory | null;
}

export interface YearReportInput {
  readonly year: number;
  /** `YYYY-MM` of today, to know how many months of the year have happened. */
  readonly todayMonth: string;
  readonly spendByMonth: readonly MonthlyTotal[];
  readonly incomeByMonth: readonly MonthlyTotal[];
  readonly categories: readonly CategorySpend[];
  readonly previousCategories: readonly CategorySpend[];
}

const sum = (rows: readonly { totalMinor: number }[]) =>
  rows.reduce((total, row) => total + row.totalMinor, 0);

export function buildYearReport(input: YearReportInput): YearReport {
  const key = (n: number) => `${input.year}-${String(n).padStart(2, '0')}`;
  const months: YearMonth[] = Array.from({ length: 12 }, (_, i) => ({
    month: key(i + 1),
    totalMinor: input.spendByMonth.find((m) => m.month === key(i + 1))?.totalMinor ?? 0,
  }));

  const totalMinor = sum(months);
  const incomeMinor = input.incomeByMonth
    .filter((m) => m.month.startsWith(`${input.year}-`))
    .reduce((total, m) => total + m.totalMinor, 0);

  const spent = months.filter((m) => m.totalMinor > 0);
  const peak = spent.reduce<YearMonth | null>(
    (a, m) => (a === null || m.totalMinor > a.totalMinor ? m : a),
    null,
  );
  const lowest = spent.reduce<YearMonth | null>(
    (a, m) => (a === null || m.totalMinor < a.totalMinor ? m : a),
    null,
  );

  const currentYear = Number(input.todayMonth.slice(0, 4));
  const elapsed =
    input.year < currentYear
      ? 12
      : input.year > currentYear
        ? 0
        : Number(input.todayMonth.slice(5, 7));
  const averageMinor = elapsed === 0 ? 0 : Math.round(totalMinor / elapsed);

  const categoriesTotal = sum(input.categories);
  const previousById = new Map(input.previousCategories.map((c) => [c.categoryId, c.totalMinor]));
  const categories: YearCategory[] = input.categories
    .map((c) => {
      const previousMinor = previousById.get(c.categoryId) ?? 0;
      return {
        id: c.categoryId,
        name: c.name ?? UNCATEGORIZED_NAME,
        color: c.color ?? '#6B7280',
        totalMinor: c.totalMinor,
        share: categoriesTotal === 0 ? 0 : c.totalMinor / categoriesTotal,
        previousMinor,
        deltaMinor: c.totalMinor - previousMinor,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));

  const previousTotalMinor = sum(input.previousCategories);
  const comparable = previousTotalMinor > 0;
  const rise = comparable
    ? categories.reduce<YearCategory | null>(
        (a, c) => (c.deltaMinor > (a?.deltaMinor ?? 0) ? c : a),
        null,
      )
    : null;
  const fall = comparable
    ? categories.reduce<YearCategory | null>(
        (a, c) => (c.deltaMinor < (a?.deltaMinor ?? 0) ? c : a),
        null,
      )
    : null;

  return {
    year: input.year,
    isEmpty: totalMinor === 0 && incomeMinor === 0,
    totalMinor,
    incomeMinor,
    savedMinor: incomeMinor - totalMinor,
    months,
    peak,
    lowest,
    averageMinor,
    categories,
    previousTotalMinor,
    deltaMinor: totalMinor - previousTotalMinor,
    biggestRise: rise,
    biggestFall: fall,
  };
}
