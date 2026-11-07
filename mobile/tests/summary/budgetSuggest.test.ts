import { budgetAlert, PACE_FROM_DAY } from '@/summary/budgetAlerts';
import { niceCeil, suggestBudgets, suggestLimit } from '@/summary/budgetSuggest';
import type { SpendEntry } from '@/summary/summaryModel';

describe('niceCeil', () => {
  it('rounds up to two significant digits', () => {
    expect(niceCeil(3_170_000)).toBe(3_200_000);
    expect(niceCeil(3_200_000)).toBe(3_200_000);
    expect(niceCeil(47_001)).toBe(48_000);
    expect(niceCeil(995)).toBe(1_000);
    expect(niceCeil(9)).toBe(9);
    expect(niceCeil(0)).toBe(0);
    expect(niceCeil(-5)).toBe(0);
  });
});

describe('suggestBudgets', () => {
  const row = (name: string, months: number[], currentMinor: number | null = null) => ({
    categoryId: name,
    name,
    months,
    currentMinor,
  });

  it('suggests a little above the typical month, rounded up', () => {
    const [s] = suggestBudgets([row('Food', [3_000_000, 3_200_000, 2_800_000])]);
    // average 3.000.000, +5% = 3.150.000 -> 3.200.000
    expect(s).toMatchObject({
      averageMinor: 3_000_000,
      suggestedMinor: 3_200_000,
      currentMinor: null,
      change: 'new',
    });
  });

  it('needs two months with spend: one month is an event', () => {
    expect(suggestBudgets([row('Gift', [5_000_000, 0, 0])])).toEqual([]);
    expect(suggestBudgets([row('Gym', [500_000, 500_000, 0])])).toHaveLength(1);
  });

  it('averages only the months that had spend, not the empty ones', () => {
    const [s] = suggestBudgets([row('Travel', [2_000_000, 0, 4_000_000])]);
    expect(s?.averageMinor).toBe(3_000_000);
  });

  it('leaves a budget alone when the suggestion is within a tenth of it', () => {
    expect(suggestBudgets([row('Food', [3_000_000, 3_000_000], 3_100_000)])).toEqual([]);
  });

  it('says raise or lower against an existing budget', () => {
    const out = suggestBudgets([
      row('Food', [3_000_000, 3_000_000], 2_000_000),
      row('Fun', [500_000, 500_000], 1_500_000),
    ]);
    expect(out.find((s) => s.name === 'Food')?.change).toBe('raise');
    expect(out.find((s) => s.name === 'Fun')?.change).toBe('lower');
  });

  it('puts the biggest first', () => {
    const out = suggestBudgets([row('A', [100_000, 100_000]), row('B', [900_000, 900_000])]);
    expect(out.map((s) => s.name)).toEqual(['B', 'A']);
  });
});

describe('suggestLimit', () => {
  it('is null with too little history or no real change, else a rounded figure', () => {
    expect(suggestLimit([10_000_000, 0, 0], null)).toBeNull();
    expect(suggestLimit([10_000_000, 12_000_000, 11_000_000], null)).toBe(12_000_000);
    expect(suggestLimit([10_000_000, 10_000_000], 10_500_000)).toBeNull();
  });
});

describe('the pace warning', () => {
  const entry = (name: string, spent: number, budget: number): SpendEntry =>
    ({
      categoryId: name,
      name,
      color: '#000',
      totalMinor: spent,
      expenseCount: 1,
      budget: { budgetMinor: budget, spentMinor: spent, over: spent > budget } as never,
      share: 1,
      percentLabel: '100%',
    }) as SpendEntry;
  const day = (d: number) => ({ day: d, daysInMonth: 30 });

  it('warns when the month is on course to end over, before 80% is used', () => {
    // 55% spent by day 15 of 30: projected 110%.
    expect(budgetAlert([entry('Food', 5_500, 10_000)], day(15))).toMatchObject({
      level: 'pace',
      names: ['Food'],
    });
  });

  it('is quiet when the pace fits the budget, exactly on it included', () => {
    expect(budgetAlert([entry('Food', 5_000, 10_000)], day(15))).toBeNull();
    expect(budgetAlert([entry('Food', 4_000, 10_000)], day(15))).toBeNull();
  });

  it('says nothing of pace early in the month, or for another month', () => {
    expect(PACE_FROM_DAY).toBe(7);
    expect(budgetAlert([entry('Food', 7_000, 10_000)], day(6))).toBeNull();
    expect(budgetAlert([entry('Food', 5_500, 10_000)], null)).toBeNull();
  });

  it('gives way to the more serious levels', () => {
    expect(
      budgetAlert([entry('Food', 8_500, 10_000), entry('Fun', 5_500, 10_000)], day(20)),
    ).toMatchObject({ level: 'near' });
    expect(
      budgetAlert([entry('Food', 12_000, 10_000), entry('Fun', 5_500, 10_000)], day(20)),
    ).toMatchObject({ level: 'over' });
  });
});
