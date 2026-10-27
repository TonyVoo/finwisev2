import { cumulativeSeries, projectedMonthEnd } from '@/expenses/spendPace';

/** The Home header's maths: a running total per day, and where the month is heading. */
describe('cumulativeSeries', () => {
  it('runs the total up to the last day with data, carrying quiet days flat', () => {
    const rows = [
      { date: '2026-10-01', totalMinor: 10 },
      { date: '2026-10-03', totalMinor: 30 },
    ];
    expect(cumulativeSeries(rows, '2026-10', 4)).toEqual([10, 10, 40, 40]);
  });

  it('is all zeros for a month with no spend', () => {
    expect(cumulativeSeries([], '2026-10', 3)).toEqual([0, 0, 0]);
  });

  it('ignores a row past the last day shown', () => {
    expect(cumulativeSeries([{ date: '2026-10-09', totalMinor: 5 }], '2026-10', 3)).toEqual([
      0, 0, 0,
    ]);
  });
});

describe('projectedMonthEnd', () => {
  it('extends the daily average over the whole month', () => {
    expect(projectedMonthEnd(300, 10, 30)).toBe(900);
  });

  it('rounds to a whole minor unit', () => {
    expect(projectedMonthEnd(100, 3, 31)).toBe(1033);
  });

  it('has no projection before any day has passed or any money is spent', () => {
    expect(projectedMonthEnd(0, 5, 30)).toBeNull();
    expect(projectedMonthEnd(100, 0, 30)).toBeNull();
  });
});
