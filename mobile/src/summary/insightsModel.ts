import type { CategorySpend } from '../db/queries';
import { formatMoney } from '../lib/money';
import { UNCATEGORIZED_NAME } from '@expense-tracker/shared';

/**
 * Plain-language observations about a month, derived from numbers the Summary already has.
 *
 * Pure and integer-only, like `summaryModel.ts`: percentages are rounded integer division on
 * minor units, and amounts are formatted at the edge by the caller. Nothing here reads the
 * database - the current and previous month's category rows go in, a list of facts comes out.
 */

export type Insight =
  | {
      readonly kind: 'vsLastMonth';
      readonly direction: 'up' | 'down' | 'same';
      readonly percent: number;
    }
  | { readonly kind: 'topCategory'; readonly name: string; readonly percent: number }
  | {
      readonly kind: 'biggestRise';
      readonly name: string;
      readonly increaseMinor: number;
    }
  | {
      readonly kind: 'incomeChange';
      readonly direction: 'up' | 'down' | 'same';
      readonly percent: number;
    }
  /** Income minus spend for the month; negative when more went out than came in. */
  | { readonly kind: 'net'; readonly netMinor: number };

/** The month's income and the previous month's, in minor units. */
export interface IncomeFigures {
  readonly current: number;
  readonly previous: number;
}

function total(rows: readonly CategorySpend[]): number {
  return rows.reduce((sum, row) => sum + row.totalMinor, 0);
}

function key(row: CategorySpend): string {
  return row.categoryId ?? row.name ?? UNCATEGORIZED_NAME;
}

/** `part / whole` as a whole percent, rounded half up, in integers. */
export function wholePercent(part: number, whole: number): number {
  return Math.floor((part * 200 + whole) / (whole * 2));
}

export function buildInsights(
  current: readonly CategorySpend[],
  previous: readonly CategorySpend[],
  income: IncomeFigures = { current: 0, previous: 0 },
): readonly Insight[] {
  const currentTotal = total(current);
  if (currentTotal <= 0) return [];
  const insights: Insight[] = [];

  const previousTotal = total(previous);
  if (previousTotal > 0) {
    const delta = currentTotal - previousTotal;
    const percent = wholePercent(Math.abs(delta), previousTotal);
    insights.push({
      kind: 'vsLastMonth',
      direction: delta === 0 || percent === 0 ? 'same' : delta > 0 ? 'up' : 'down',
      percent,
    });
  }

  const top = current.reduce<CategorySpend | null>(
    (best, row) => (best === null || row.totalMinor > best.totalMinor ? row : best),
    null,
  );
  if (top !== null && top.totalMinor > 0) {
    insights.push({
      kind: 'topCategory',
      name: top.name ?? UNCATEGORIZED_NAME,
      percent: wholePercent(top.totalMinor, currentTotal),
    });
  }

  if (previousTotal > 0) {
    const before = new Map(previous.map((row) => [key(row), row.totalMinor]));
    let rise: { row: CategorySpend; increase: number } | null = null;
    for (const row of current) {
      const increase = row.totalMinor - (before.get(key(row)) ?? 0);
      if (increase > 0 && (rise === null || increase > rise.increase)) rise = { row, increase };
    }
    if (rise !== null) {
      insights.push({
        kind: 'biggestRise',
        name: rise.row.name ?? UNCATEGORIZED_NAME,
        increaseMinor: rise.increase,
      });
    }
  }

  if (income.current > 0 && income.previous > 0) {
    const delta = income.current - income.previous;
    const percent = wholePercent(Math.abs(delta), income.previous);
    insights.push({
      kind: 'incomeChange',
      direction: delta === 0 || percent === 0 ? 'same' : delta > 0 ? 'up' : 'down',
      percent,
    });
  }

  if (income.current > 0) {
    insights.push({ kind: 'net', netMinor: income.current - currentTotal });
  }

  return insights;
}

/** The sentence for one insight. `previousLabel` is the previous month's name, e.g. `September`. */
export function insightText(
  insight: Insight,
  copy: {
    readonly up: string;
    readonly down: string;
    readonly same: string;
    readonly top: string;
    readonly rise: string;
    readonly incomeUp: string;
    readonly incomeDown: string;
    readonly incomeSame: string;
    readonly kept: string;
    readonly overspent: string;
  },
  previousLabel: string,
  currency: string,
): string {
  switch (insight.kind) {
    case 'vsLastMonth':
      return copy[insight.direction === 'same' ? 'same' : insight.direction]
        .replace('{percent}', String(insight.percent))
        .replace('{month}', previousLabel);
    case 'topCategory':
      return copy.top.replace('{name}', insight.name).replace('{percent}', String(insight.percent));
    case 'biggestRise':
      return copy.rise
        .replace('{name}', insight.name)
        .replace('{amount}', formatMoney(insight.increaseMinor, currency))
        .replace('{month}', previousLabel);
    case 'incomeChange': {
      const template = { up: copy.incomeUp, down: copy.incomeDown, same: copy.incomeSame }[
        insight.direction
      ];
      return template
        .replace('{percent}', String(insight.percent))
        .replace('{month}', previousLabel);
    }
    case 'net':
      return (insight.netMinor >= 0 ? copy.kept : copy.overspent).replace(
        '{amount}',
        formatMoney(Math.abs(insight.netMinor), currency),
      );
  }
}
