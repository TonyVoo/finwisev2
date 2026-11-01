import type { CategorySpend } from '../../src/db/queries';
import { COPY } from '../../src/copy/strings';
import { formatMoney } from '../../src/lib/money';
import {
  buildInsights,
  daysLeftInMonth,
  insightText,
  wholePercent,
} from '../../src/summary/insightsModel';

function row(id: string, name: string, totalMinor: number): CategorySpend {
  return {
    categoryId: id,
    name,
    color: '#000000',
    monthlyBudgetMinor: null,
    totalMinor,
    expenseCount: 1,
  } as CategorySpend;
}

describe('buildInsights', () => {
  it('says nothing for an empty month', () => {
    expect(buildInsights([], [row('a', 'Food', 100)])).toEqual([]);
  });

  it('reports the top category, and no comparison without a previous month', () => {
    expect(buildInsights([row('a', 'Food', 300), row('b', 'Fun', 100)], [])).toEqual([
      { kind: 'topCategory', name: 'Food', percent: 75 },
    ]);
  });

  it('compares with the previous month and finds the biggest rise', () => {
    const insights = buildInsights(
      [row('a', 'Food', 300), row('b', 'Fun', 200)],
      [row('a', 'Food', 200), row('b', 'Fun', 200)],
    );
    expect(insights).toEqual([
      { kind: 'vsLastMonth', direction: 'up', percent: 25 },
      { kind: 'topCategory', name: 'Food', percent: 60 },
      { kind: 'biggestRise', name: 'Food', increaseMinor: 100 },
    ]);
  });

  it('reports a fall, and omits the rise when nothing grew', () => {
    const insights = buildInsights([row('a', 'Food', 100)], [row('a', 'Food', 400)]);
    expect(insights.map((i) => i.kind)).toEqual(['vsLastMonth', 'topCategory']);
    expect(insights[0]).toEqual({ kind: 'vsLastMonth', direction: 'down', percent: 75 });
  });

  it('counts a brand-new category as a rise from zero', () => {
    const insights = buildInsights(
      [row('a', 'Food', 100), row('c', 'Gym', 500)],
      [row('a', 'Food', 100)],
    );
    expect(insights.at(-1)).toEqual({ kind: 'biggestRise', name: 'Gym', increaseMinor: 500 });
  });
});

describe('wholePercent', () => {
  it('rounds half up in integers', () => {
    expect(wholePercent(1, 8)).toBe(13);
    expect(wholePercent(1, 3)).toBe(33);
  });
});

describe('income insights', () => {
  const spend = [row('a', 'Food', 300)];

  it('says nothing about income when there is none', () => {
    const kinds = buildInsights(spend, [], { current: 0, previous: 0 }).map((i) => i.kind);
    expect(kinds).not.toContain('net');
    expect(kinds).not.toContain('incomeChange');
  });

  it('reports what was kept of this months income', () => {
    expect(buildInsights(spend, [], { current: 1000, previous: 0 }).at(-1)).toEqual({
      kind: 'net',
      netMinor: 700,
    });
  });

  it('reports overspending as a negative net', () => {
    expect(buildInsights(spend, [], { current: 100, previous: 0 }).at(-1)).toEqual({
      kind: 'net',
      netMinor: -200,
    });
  });

  it('compares income with the previous month only when both months have some', () => {
    const both = buildInsights(spend, [], { current: 1500, previous: 1000 });
    expect(both.find((i) => i.kind === 'incomeChange')).toEqual({
      kind: 'incomeChange',
      direction: 'up',
      percent: 50,
    });
    const down = buildInsights(spend, [], { current: 500, previous: 1000 });
    expect(down.find((i) => i.kind === 'incomeChange')).toMatchObject({ direction: 'down' });
    const noPrevious = buildInsights(spend, [], { current: 1500, previous: 0 });
    expect(noPrevious.find((i) => i.kind === 'incomeChange')).toBeUndefined();
  });
});

/**
 * Budget pace (`docs/design/16-monthly-insights.md`): one line about the budget closest to or past its limit,
 * for the current month only. Same rules as Home's budget banner: near is 80% or more, in integers
 * (`spent * 5 >= budget * 4`), and over is strictly past the limit.
 */
function budgeted(id: string, name: string, spent: number, budget: number | null): CategorySpend {
  return { ...row(id, name, spent), monthlyBudgetMinor: budget } as CategorySpend;
}

const budgetKinds = (insights: ReturnType<typeof buildInsights>) =>
  insights.filter((i) => i.kind === 'budgetPace' || i.kind === 'budgetOver');

describe('budget pace', () => {
  const pace = (rows: CategorySpend[], daysLeft: number | null = 9) =>
    budgetKinds(buildInsights(rows, [], { current: 0, previous: 0 }, daysLeft));

  it('says a budget is nearly used, with the days left, from 80%', () => {
    expect(pace([budgeted('a', 'Eating out', 80, 100)])).toEqual([
      { kind: 'budgetPace', name: 'Eating out', usedPercent: 80, daysLeft: 9 },
    ]);
  });

  it('says nothing below 80%, decided in integers with no rounding up into it', () => {
    expect(pace([budgeted('a', 'Food', 79, 100)])).toEqual([]);
    expect(pace([budgeted('a', 'Food', 799, 1000)])).toEqual([]);
    expect(pace([budgeted('a', 'Food', 800, 1000)])).toHaveLength(1);
  });

  it('says 100% when exactly on the budget, which is a month going to plan, not over', () => {
    expect(pace([budgeted('a', 'Food', 100, 100)])).toEqual([
      { kind: 'budgetPace', name: 'Food', usedPercent: 100, daysLeft: 9 },
    ]);
  });

  it('says how far over, when strictly past the budget', () => {
    expect(pace([budgeted('a', 'Food', 112, 100)])).toEqual([
      { kind: 'budgetOver', name: 'Food', overMinor: 12 },
    ]);
  });

  it('shows only one line: the budget that has used the largest share', () => {
    expect(
      pace([budgeted('a', 'Food', 90, 100), budgeted('b', 'Fun', 95, 100)]).map((i) => i.kind),
    ).toEqual(['budgetPace']);
    expect(pace([budgeted('a', 'Food', 90, 100), budgeted('b', 'Fun', 95, 100)])[0]).toMatchObject({
      name: 'Fun',
    });
  });

  it('puts a budget that is over before one that is merely close', () => {
    expect(pace([budgeted('a', 'Food', 99, 100), budgeted('b', 'Fun', 110, 100)])).toEqual([
      { kind: 'budgetOver', name: 'Fun', overMinor: 10 },
    ]);
  });

  it('breaks a tie in share by the larger spend', () => {
    expect(
      pace([budgeted('a', 'Small', 90, 100), budgeted('b', 'Big', 180, 200)])[0],
    ).toMatchObject({ name: 'Big' });
  });

  it('says nothing for a past month, where "days left" means nothing', () => {
    expect(pace([budgeted('a', 'Food', 150, 100)], null)).toEqual([]);
  });

  it.each([
    ['no budget', budgeted('a', 'Food', 500, null)],
    ['a budget of zero', budgeted('a', 'Food', 500, 0)],
    ['no spend', budgeted('a', 'Food', 0, 100)],
  ])('ignores a category with %s', (_name, entry) => {
    expect(pace([entry, budgeted('b', 'Other', 10, 1000)])).toEqual([]);
  });

  it('comes last, after the comparisons, so the rest of the card reads as before', () => {
    const insights = buildInsights(
      [budgeted('a', 'Food', 90, 100)],
      [row('a', 'Food', 60)],
      { current: 500, previous: 400 },
      5,
    );
    expect(insights.at(-1)?.kind).toBe('budgetPace');
    expect(insights.map((i) => i.kind)).toEqual([
      'vsLastMonth',
      'topCategory',
      'biggestRise',
      'incomeChange',
      'net',
      'budgetPace',
    ]);
  });

  it('is not added when the call does not say how many days are left', () => {
    expect(budgetKinds(buildInsights([budgeted('a', 'Food', 150, 100)], []))).toEqual([]);
  });
});

describe('budget pace wording', () => {
  const copy = COPY.summary.insights;
  const say = (insight: Parameters<typeof insightText>[0]) =>
    insightText(insight, copy, 'September', 'USD');

  it('names the category, the share and the days left', () => {
    expect(say({ kind: 'budgetPace', name: 'Eating out', usedPercent: 87, daysLeft: 9 })).toBe(
      "You have used 87% of Eating out's budget with 9 days left.",
    );
  });

  it('says "1 day", and "today is the last day", rather than "1 days" or "0 days"', () => {
    expect(say({ kind: 'budgetPace', name: 'Food', usedPercent: 90, daysLeft: 1 })).toBe(
      "You have used 90% of Food's budget with 1 day left.",
    );
    expect(say({ kind: 'budgetPace', name: 'Food', usedPercent: 90, daysLeft: 0 })).toBe(
      "You have used 90% of Food's budget, and today is the last day.",
    );
  });

  it('says how far over, in the account currency', () => {
    expect(say({ kind: 'budgetOver', name: 'Food', overMinor: 1200 })).toBe(
      `You are over Food's budget by ${formatMoney(1200, 'USD')}.`,
    );
  });
});

describe('daysLeftInMonth', () => {
  it.each([
    ['2026-10-14', 17],
    ['2026-10-31', 0],
    ['2026-11-01', 29],
    ['2026-02-28', 0],
    ['2024-02-10', 19],
    ['2026-12-31', 0],
  ])('%s has %i days left', (today, left) => {
    expect(daysLeftInMonth(today)).toBe(left);
  });
});
