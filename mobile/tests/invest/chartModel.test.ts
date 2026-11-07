import type { MarketQuotePoint } from '@expense-tracker/shared';
import { downsample, rangeChange, sliceRange, toBars } from '@/invest/chartModel';

function series(closes: number[]): MarketQuotePoint[] {
  return closes.map((close, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    close,
    volume: 1,
  }));
}

describe('sliceRange', () => {
  const long = series(Array.from({ length: 28 }, (_, i) => 100 + i));

  it('takes the most recent sessions the range means', () => {
    expect(sliceRange(long, '1m')).toHaveLength(21);
    expect(sliceRange(long, '1m').at(-1)).toEqual(long.at(-1));
  });

  it('gives what there is when the history is shorter than the range', () => {
    expect(sliceRange(long, '1y')).toHaveLength(28);
  });
});

describe('downsample', () => {
  it('leaves a short series alone', () => {
    expect(downsample(series([1, 2, 3]), 60)).toHaveLength(3);
  });

  it('caps the length and keeps both ends', () => {
    const points = series(Array.from({ length: 200 }, (_, i) => i + 1));
    const out = downsample(points, 60);
    expect(out).toHaveLength(60);
    expect(out[0]).toEqual(points[0]);
    expect(out.at(-1)).toEqual(points.at(-1));
  });
});

describe('toBars', () => {
  it('scales the highest close to 1 and keeps the lowest visible', () => {
    const bars = toBars(series([10, 20, 15]));
    expect(bars.map((b) => b.ratio)).toEqual([0.08, 1, 0.08 + 0.92 * 0.5]);
  });

  it('draws a flat series at half height', () => {
    expect(toBars(series([5, 5, 5])).map((b) => b.ratio)).toEqual([0.5, 0.5, 0.5]);
  });

  it('draws nothing for nothing', () => {
    expect(toBars([])).toEqual([]);
  });
});

describe('rangeChange', () => {
  it('is the move from the first close to the last', () => {
    expect(rangeChange(series([100, 110]))).toBeCloseTo(0.1);
    expect(rangeChange(series([100, 90]))).toBeCloseTo(-0.1);
  });

  it('needs two points', () => {
    expect(rangeChange(series([100]))).toBeNull();
    expect(rangeChange([])).toBeNull();
  });
});
