import type { CategorySpend } from '@/db/queries';
import { buildYearReport } from '@/year/yearReport';

const cat = (id: string, name: string, total: number): CategorySpend => ({
  categoryId: id,
  name,
  color: '#112233',
  monthlyBudgetMinor: null,
  totalMinor: total,
  expenseCount: 1,
});

const base = {
  year: 2026,
  todayMonth: '2026-12',
  spendByMonth: [],
  incomeByMonth: [],
  categories: [],
  previousCategories: [],
};

describe('the year in numbers', () => {
  it('lists twelve months, with zero where nothing was spent', () => {
    const report = buildYearReport({
      ...base,
      spendByMonth: [
        { month: '2026-03', totalMinor: 5000 },
        { month: '2026-11', totalMinor: 7000 },
      ],
    });

    expect(report.months).toHaveLength(12);
    expect(report.months[0]).toEqual({ month: '2026-01', totalMinor: 0 });
    expect(report.months[2]?.totalMinor).toBe(5000);
    expect(report.totalMinor).toBe(12000);
  });

  it('finds the dearest and the cheapest month among those that had spending', () => {
    const report = buildYearReport({
      ...base,
      spendByMonth: [
        { month: '2026-03', totalMinor: 5000 },
        { month: '2026-06', totalMinor: 9000 },
        { month: '2026-09', totalMinor: 2000 },
      ],
    });
    expect(report.peak).toEqual({ month: '2026-06', totalMinor: 9000 });
    expect(report.lowest).toEqual({ month: '2026-09', totalMinor: 2000 });
  });

  it('averages over the months that have happened in the current year, and over all twelve in a past one', () => {
    const spend = [{ month: '2026-01', totalMinor: 30000 }];
    expect(
      buildYearReport({ ...base, todayMonth: '2026-03', spendByMonth: spend }).averageMinor,
    ).toBe(10000);
    expect(
      buildYearReport({ ...base, todayMonth: '2027-02', spendByMonth: spend }).averageMinor,
    ).toBe(2500);
  });

  it('reports income and what was left', () => {
    const report = buildYearReport({
      ...base,
      spendByMonth: [{ month: '2026-01', totalMinor: 4000 }],
      incomeByMonth: [{ month: '2026-01', totalMinor: 10000 }],
    });
    expect(report).toMatchObject({ incomeMinor: 10000, savedMinor: 6000 });
  });

  it('shares the year between categories, largest first, and compares each with last year', () => {
    const report = buildYearReport({
      ...base,
      spendByMonth: [{ month: '2026-05', totalMinor: 20000 }],
      categories: [cat('a', 'Food', 6000), cat('b', 'Rent', 12000), cat('c', 'Fun', 2000)],
      previousCategories: [cat('a', 'Food', 3000), cat('b', 'Rent', 12000), cat('c', 'Fun', 5000)],
    });

    expect(report.categories.map((c) => c.name)).toEqual(['Rent', 'Food', 'Fun']);
    expect(report.categories[0]).toMatchObject({ share: 0.6, previousMinor: 12000, deltaMinor: 0 });
    expect(report.biggestRise).toMatchObject({ name: 'Food', deltaMinor: 3000 });
    expect(report.biggestFall).toMatchObject({ name: 'Fun', deltaMinor: -3000 });
  });

  it('has no rise or fall without a last year to compare with, or when nothing changed', () => {
    const none = buildYearReport({ ...base, categories: [cat('a', 'Food', 6000)] });
    expect(none.biggestRise).toBeNull();
    expect(none.biggestFall).toBeNull();
    expect(none.previousTotalMinor).toBe(0);
  });

  it('compares the total with last year’s', () => {
    const report = buildYearReport({
      ...base,
      spendByMonth: [{ month: '2026-05', totalMinor: 6000 }],
      categories: [cat('a', 'Food', 6000)],
      previousCategories: [cat('a', 'Food', 4000)],
    });
    expect(report).toMatchObject({ previousTotalMinor: 4000, deltaMinor: 2000 });
  });

  it('is empty for a year with nothing in it', () => {
    const report = buildYearReport(base);
    expect(report).toMatchObject({ totalMinor: 0, isEmpty: true, peak: null, lowest: null });
  });
});
