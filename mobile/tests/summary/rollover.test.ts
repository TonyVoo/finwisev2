import type { CategorySpend } from '@/db/queries';
import { ROLLOVER_MONTHS, rolloverBudgets } from '@/summary/rollover';

const row = (id: string, total: number, budget: number | null): CategorySpend => ({
  categoryId: id,
  name: id,
  color: '#000000',
  monthlyBudgetMinor: budget,
  totalMinor: total,
  expenseCount: 1,
});

describe('rolling unspent budget into the next month', () => {
  it('adds what was left last month to this month', () => {
    const [food] = rolloverBudgets([row('food', 30000, 50000)], [[row('food', 20000, 50000)]]);
    // 50 000 budget, 20 000 spent last month: 30 000 carried.
    expect(food).toMatchObject({ monthlyBudgetMinor: 80000, carriedMinor: 30000 });
  });

  it('carries nothing after an overspend, and never a debt', () => {
    const [food] = rolloverBudgets([row('food', 0, 50000)], [[row('food', 70000, 50000)]]);
    expect(food).toMatchObject({ monthlyBudgetMinor: 50000 });
    expect(food?.carriedMinor).toBeUndefined();
  });

  it('chains through several months, oldest first, and what was carried can be carried again', () => {
    const history = [
      [row('food', 10000, 50000)], // 40 000 left
      [row('food', 60000, 50000)], // 90 000 available, 30 000 left
      [row('food', 90000, 50000)], // 80 000 available, nothing left
    ];
    expect(rolloverBudgets([row('food', 0, 50000)], history)[0]?.carriedMinor).toBeUndefined();

    const second = rolloverBudgets([row('food', 0, 50000)], history.slice(0, 2));
    expect(second[0]).toMatchObject({ monthlyBudgetMinor: 80000, carriedMinor: 30000 });
  });

  it('counts a month with no spending in that category as all left, once it has started being spent', () => {
    const [food] = rolloverBudgets([row('food', 0, 50000)], [[row('food', 10000, 50000)], [], []]);
    // 40 000 left, then two empty months add 50 000 each.
    expect(food).toMatchObject({ monthlyBudgetMinor: 190000, carriedMinor: 140000 });
  });

  it('does not hand a new budget the months before its category was ever spent in', () => {
    const [food] = rolloverBudgets([row('food', 0, 50000)], [[], [], []]);
    expect(food?.carriedMinor).toBeUndefined();
  });

  it('leaves a category without a budget, and one the earlier months did not have, alone', () => {
    const rows = [row('rent', 5000, null), row('new', 0, 1000)];
    expect(rolloverBudgets(rows, [[row('rent', 1, null)]])).toEqual(rows);
  });

  it('looks back at most six months', () => {
    expect(ROLLOVER_MONTHS).toBe(6);
  });
});
