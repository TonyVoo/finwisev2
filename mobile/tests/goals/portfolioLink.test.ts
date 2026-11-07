import type { GoalListItem } from '@/db/queries';
import { withPortfolio } from '@/goals/portfolioLink';
import { goalProgress } from '@/goals/goalModel';

const goal: GoalListItem = {
  id: 'g1',
  name: 'Laptop',
  targetMinor: 30_000_000,
  savedMinor: 5_000_000,
  currency: 'VND',
  deadline: null,
  pending: false,
};

describe('withPortfolio', () => {
  it('adds what the stocks are worth to the linked goal only', () => {
    const linked = withPortfolio(goal, 'g1', 10_000_000);
    expect(linked.includedMinor).toBe(10_000_000);
    expect(goalProgress(linked.goal.savedMinor, linked.goal.targetMinor).percent).toBe(50);

    expect(withPortfolio(goal, 'other', 10_000_000)).toEqual({ goal, includedMinor: 0 });
    expect(withPortfolio(goal, null, 10_000_000)).toEqual({ goal, includedMinor: 0 });
  });

  it('ignores a goal that is not in dong, and a portfolio worth nothing', () => {
    const usd = { ...goal, currency: 'USD' };
    expect(withPortfolio(usd, 'g1', 10_000_000).includedMinor).toBe(0);
    expect(withPortfolio(goal, 'g1', 0).includedMinor).toBe(0);
    expect(withPortfolio(goal, 'g1', -5).includedMinor).toBe(0);
  });

  it('rounds to a whole dong', () => {
    expect(withPortfolio(goal, 'g1', 1000.6).includedMinor).toBe(1001);
  });
});
