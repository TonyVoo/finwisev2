import type { CategorySpend } from '../../src/db/queries';
import { buildInsights, wholePercent } from '../../src/summary/insightsModel';

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
