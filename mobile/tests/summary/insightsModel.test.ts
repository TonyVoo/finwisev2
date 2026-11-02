import type { CategorySpend } from '../../src/db/queries';
import { COPY } from '../../src/copy/strings';
import { formatMoney } from '../../src/lib/money';
import {
  buildInsights,
  daysLeftInMonth,
  insightText,
  monthProgress,
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

describe('monthProgress', () => {
  it('is the day of the month and how many days it has', () => {
    expect(monthProgress('2026-11-12')).toEqual({ day: 12, daysInMonth: 30 });
    expect(monthProgress('2026-02-28')).toEqual({ day: 28, daysInMonth: 28 });
    expect(monthProgress('2028-02-29')).toEqual({ day: 29, daysInMonth: 29 });
    expect(monthProgress('2026-10-01')).toEqual({ day: 1, daysInMonth: 31 });
  });
});

const NOV = (day: number) => ({ day, daysInMonth: 30 });
const kinds = (insights: ReturnType<typeof buildInsights>) => insights.map((i) => i.kind);

describe('the forecast', () => {
  const forecastOf = (
    spent: number,
    day: number,
    previous: readonly CategorySpend[] = [],
    daysLeft: number | null = 30 - day,
  ) =>
    buildInsights([row('a', 'Food', spent)], previous, undefined, daysLeft, {
      progress: NOV(day),
      history: [],
    }).find((i) => i.kind === 'forecast');

  it('scales the spend so far to the whole month', () => {
    expect(forecastOf(3000, 10)).toEqual({ kind: 'forecast', projectedMinor: 9000, versus: null });
    expect(forecastOf(1000, 15)).toEqual({ kind: 'forecast', projectedMinor: 2000, versus: null });
  });

  it('rounds half up, in whole minor units', () => {
    // 1001 * 30 / 20 = 1501.5
    expect(forecastOf(1001, 20)).toMatchObject({ projectedMinor: 1502 });
    // 1000 * 30 / 7 = 4285.71...
    expect(forecastOf(1000, 7)).toMatchObject({ projectedMinor: 4286 });
  });

  it('waits until the 5th, and goes quiet on the last day', () => {
    expect(forecastOf(1000, 4)).toBeUndefined();
    expect(forecastOf(1000, 5)).toBeDefined();
    expect(forecastOf(1000, 29)).toBeDefined();
    expect(forecastOf(1000, 30)).toBeUndefined();
  });

  it('is only for the current month, and needs some spending', () => {
    expect(
      buildInsights([row('a', 'Food', 1000)], [], undefined, null, {
        progress: null,
        history: [],
      }).map((i) => i.kind),
    ).not.toContain('forecast');
    expect(buildInsights([], [], undefined, 20, { progress: NOV(10), history: [] })).toEqual([]);
  });

  it('is not offered when no month context is given (the older call shape)', () => {
    expect(kinds(buildInsights([row('a', 'Food', 1000)], []))).not.toContain('forecast');
  });

  it('compares with last month: more, less, or about the same', () => {
    // Projected 9000 against 8000, 10000, and 9100.
    expect(forecastOf(3000, 10, [row('a', 'Food', 8000)])).toMatchObject({
      versus: { direction: 'more', amountMinor: 1000 },
    });
    expect(forecastOf(3000, 10, [row('a', 'Food', 10000)])).toMatchObject({
      versus: { direction: 'less', amountMinor: 1000 },
    });
    expect(forecastOf(3000, 10, [row('a', 'Food', 9100)])).toMatchObject({
      versus: { direction: 'same', amountMinor: 100 },
    });
  });

  it('treats under 3% of last month as about the same, and 3% or more as a difference', () => {
    // Projected 9000. Against 9270 the gap is 270, which is 2.9%: the same. Against 9300 it is 300: 3.2%.
    expect(forecastOf(3000, 10, [row('a', 'Food', 9270)])).toMatchObject({
      versus: { direction: 'same', amountMinor: 270 },
    });
    expect(forecastOf(3000, 10, [row('a', 'Food', 9300)])).toMatchObject({
      versus: { direction: 'less', amountMinor: 300 },
    });
    // The same boundary on the other side: 8730 is 3.1% below 9000.
    expect(forecastOf(3000, 10, [row('a', 'Food', 8730)])).toMatchObject({
      versus: { direction: 'more', amountMinor: 270 },
    });
  });

  it('comes after the other lines, so the card keeps its order', () => {
    const insights = buildInsights(
      [row('a', 'Food', 3000)],
      [row('a', 'Food', 8000)],
      undefined,
      20,
      { progress: NOV(10), history: [] },
    );
    expect(kinds(insights).at(-1)).toBe('forecast');
  });
});

describe('the unusual-spend line', () => {
  const month = (...rows: CategorySpend[]) => rows;
  /** This month's rows against earlier months; the current month is November, day 20. */
  const unusualOf = (
    current: readonly CategorySpend[],
    history: readonly (readonly CategorySpend[])[],
    progress: { day: number; daysInMonth: number } | null = NOV(20),
  ) =>
    buildInsights(
      current,
      history[0] ?? [],
      undefined,
      progress === null ? null : 30 - progress.day,
      {
        progress,
        history,
      },
    ).find((i) => i.kind === 'unusual');

  it('names a category that has already passed a whole typical month by half again', () => {
    const found = unusualOf(month(row('g', 'Groceries', 48000), row('x', 'Fun', 10000)), [
      month(row('g', 'Groceries', 30000)),
      month(row('g', 'Groceries', 30000)),
    ]);

    expect(found).toEqual({
      kind: 'unusual',
      name: 'Groceries',
      spentMinor: 48000,
      usualMinor: 30000,
    });
  });

  it('needs 1.5x exactly: 450 against a typical 300 counts, 449 does not', () => {
    const history = [month(row('g', 'Groceries', 300)), month(row('g', 'Groceries', 300))];

    expect(
      unusualOf(month(row('g', 'Groceries', 450), row('x', 'Fun', 600)), history),
    ).toBeDefined();
    expect(
      unusualOf(month(row('g', 'Groceries', 449), row('x', 'Fun', 600)), history),
    ).toBeUndefined();
  });

  it('is not fooled by a steady lump, which is 1.0x of a typical month all month', () => {
    const rent = month(row('r', 'Rent', 700000), row('f', 'Food', 20000));
    const history = [month(row('r', 'Rent', 700000)), month(row('r', 'Rent', 700000))];

    expect(unusualOf(rent, history, NOV(5))).toBeUndefined();
  });

  it('needs at least two earlier months with spending', () => {
    const current = month(row('g', 'Groceries', 90000));

    expect(unusualOf(current, [])).toBeUndefined();
    expect(unusualOf(current, [month(row('g', 'Groceries', 30000))])).toBeUndefined();
    expect(unusualOf(current, [month(row('g', 'Groceries', 30000)), []])).toBeUndefined();
    expect(
      unusualOf(current, [
        month(row('g', 'Groceries', 30000)),
        month(row('g', 'Groceries', 30000)),
      ]),
    ).toBeDefined();
  });

  it('averages over the months that had spending, counting an absent category as zero', () => {
    const current = month(row('g', 'Groceries', 45000), row('x', 'Fun', 5000));
    // Groceries: 30000, nothing, nothing -> typical 10000 over three months with other spending.
    const history = [
      month(row('g', 'Groceries', 30000), row('x', 'Fun', 100)),
      month(row('x', 'Fun', 100)),
      month(row('x', 'Fun', 100)),
    ];

    expect(unusualOf(current, history)).toMatchObject({ name: 'Groceries', usualMinor: 10000 });
  });

  it('ignores earlier months with no spending when averaging', () => {
    const current = month(row('g', 'Groceries', 45000));
    const history = [month(row('g', 'Groceries', 30000)), month(row('g', 'Groceries', 30000)), []];

    expect(unusualOf(current, history)).toMatchObject({ usualMinor: 30000 });
  });

  it('skips a small category whose excess is under a tenth of the month so far', () => {
    const current = month(row('b', 'Big', 100000), row('s', 'Small', 2000));
    const history = [
      month(row('s', 'Small', 500), row('b', 'Big', 100000)),
      month(row('s', 'Small', 500), row('b', 'Big', 100000)),
    ];

    // Small is 4x typical but its 1500 excess is 1.5% of 102000.
    expect(unusualOf(current, history)).toBeUndefined();
  });

  it('skips a category with no history: new is not unusual', () => {
    const current = month(row('n', 'New', 90000), row('g', 'Groceries', 10000));
    const history = [month(row('g', 'Groceries', 10000)), month(row('g', 'Groceries', 10000))];

    expect(unusualOf(current, history)).toBeUndefined();
  });

  it('picks the largest excess when several qualify', () => {
    const current = month(row('a', 'A', 60000), row('b', 'B', 90000));
    const history = [
      month(row('a', 'A', 20000), row('b', 'B', 40000)),
      month(row('a', 'A', 20000), row('b', 'B', 40000)),
    ];

    // A: +40000, B: +50000.
    expect(unusualOf(current, history)).toMatchObject({ name: 'B' });
  });

  it('is for the current month only', () => {
    const history = [month(row('g', 'Groceries', 30000)), month(row('g', 'Groceries', 30000))];

    expect(unusualOf(month(row('g', 'Groceries', 90000)), history, null)).toBeUndefined();
  });

  it('keeps categories apart by id, or by name when there is none', () => {
    const noId = (name: string, totalMinor: number) =>
      ({ ...row('x', name, totalMinor), categoryId: null }) as CategorySpend;
    const history = [month(noId('Misc', 30000)), month(noId('Misc', 30000))];

    expect(unusualOf(month(noId('Misc', 60000)), history)).toMatchObject({ name: 'Misc' });
  });
});

describe('insightText for the new lines', () => {
  const copy = COPY.summary.insights;
  const text = (insight: Parameters<typeof insightText>[0]) =>
    insightText(insight, copy, 'September', 'USD');

  it('words the forecast alone, and against last month', () => {
    expect(text({ kind: 'forecast', projectedMinor: 124000, versus: null })).toBe(
      `At this pace you will spend about ${formatMoney(124000, 'USD')} this month.`,
    );
    expect(
      text({
        kind: 'forecast',
        projectedMinor: 124000,
        versus: { direction: 'more', amountMinor: 14000 },
      }),
    ).toBe(
      `At this pace you will spend about ${formatMoney(124000, 'USD')} this month, ${formatMoney(14000, 'USD')} more than September.`,
    );
    expect(
      text({
        kind: 'forecast',
        projectedMinor: 124000,
        versus: { direction: 'less', amountMinor: 14000 },
      }),
    ).toContain(`${formatMoney(14000, 'USD')} less than September.`);
    expect(
      text({
        kind: 'forecast',
        projectedMinor: 124000,
        versus: { direction: 'same', amountMinor: 100 },
      }),
    ).toContain('about the same as September.');
  });

  it('words the unusual line with the category and both amounts', () => {
    expect(text({ kind: 'unusual', name: 'Groceries', spentMinor: 48000, usualMinor: 30000 })).toBe(
      `Groceries is already ${formatMoney(48000, 'USD')}, more than a typical month (about ${formatMoney(30000, 'USD')}).`,
    );
  });
});
