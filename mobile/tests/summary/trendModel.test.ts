import { TREND_MONTHS, buildTrend } from '@/summary/trendModel';

describe('buildTrend', () => {
  it('covers the six months ending at the selected one, oldest first, gaps as zero', () => {
    const trend = buildTrend(
      [
        { month: '2026-10', totalMinor: 30000 },
        { month: '2026-08', totalMinor: 15000 },
      ],
      '2026-10',
    );
    expect(trend.bars.map((bar) => bar.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(trend.bars.map((bar) => bar.totalMinor)).toEqual([0, 0, 0, 15000, 0, 30000]);
    expect(trend.bars).toHaveLength(TREND_MONTHS);
  });

  it('scales to the tallest bar and marks only the selected month', () => {
    const trend = buildTrend(
      [
        { month: '2026-10', totalMinor: 40000 },
        { month: '2026-09', totalMinor: 10000 },
      ],
      '2026-10',
    );
    const last = trend.bars.at(-1)!;
    expect(last.fraction).toBe(1);
    expect(last.selected).toBe(true);
    expect(trend.bars.find((bar) => bar.month === '2026-09')!.fraction).toBe(0.25);
    expect(trend.bars.filter((bar) => bar.selected)).toHaveLength(1);
  });

  it('crosses a year boundary', () => {
    const trend = buildTrend([], '2026-02');
    expect(trend.bars[0]!.month).toBe('2025-09');
  });

  it('is only worth showing from two months with spend', () => {
    expect(buildTrend([], '2026-10').isWorthShowing).toBe(false);
    expect(buildTrend([{ month: '2026-10', totalMinor: 5 }], '2026-10').isWorthShowing).toBe(false);
    expect(
      buildTrend(
        [
          { month: '2026-10', totalMinor: 5 },
          { month: '2026-07', totalMinor: 5 },
        ],
        '2026-10',
      ).isWorthShowing,
    ).toBe(true);
  });

  it('never gives a bar negative height, and zero-only data has no fractions', () => {
    const trend = buildTrend([{ month: '2026-10', totalMinor: -500 }], '2026-10');
    expect(trend.bars.every((bar) => bar.fraction === 0 && bar.totalMinor === 0)).toBe(true);
  });
});
