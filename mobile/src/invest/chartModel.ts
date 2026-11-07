import type { MarketQuotePoint } from '@expense-tracker/shared';

/**
 * The price chart's pure parts: which stretch of the series a range button means, and how it is
 * boiled down to a handful of bars. The chart is plain Views (no chart library, as with the
 * spend trend), so the number of bars is capped to what a phone's width can draw legibly.
 */

export type ChartRange = '1m' | '3m' | '6m' | '1y';

export const CHART_RANGES: readonly ChartRange[] = ['1m', '3m', '6m', '1y'];

/** Trading sessions in each range: about 21 to the month, 250 to the year. */
const SESSIONS: Readonly<Record<ChartRange, number>> = { '1m': 21, '3m': 63, '6m': 126, '1y': 250 };

export const MAX_BARS = 60;

export function sliceRange(
  series: readonly MarketQuotePoint[],
  range: ChartRange,
): readonly MarketQuotePoint[] {
  return series.slice(-SESSIONS[range]);
}

/**
 * At most `max` closes, evenly spread, always keeping the first and the last so the chart starts
 * and ends where the data does.
 */
export function downsample(
  points: readonly MarketQuotePoint[],
  max: number = MAX_BARS,
): readonly MarketQuotePoint[] {
  if (points.length <= max || max < 2) return points.slice(-Math.max(max, 0));
  const out: MarketQuotePoint[] = [];
  for (let i = 0; i < max; i += 1) {
    const point = points[Math.round((i * (points.length - 1)) / (max - 1))];
    if (point !== undefined) out.push(point);
  }
  return out;
}

export interface Bar {
  readonly date: string;
  readonly close: number;
  /** 0..1 of the chart's height: the lowest close in view is 0.08, the highest 1, so no bar vanishes. */
  readonly ratio: number;
}

const FLOOR = 0.08;

export function toBars(points: readonly MarketQuotePoint[]): readonly Bar[] {
  if (points.length === 0) return [];
  const closes = points.map((p) => p.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const span = high - low;
  return points.map((p) => ({
    date: p.date,
    close: p.close,
    ratio: span === 0 ? 0.5 : FLOOR + ((p.close - low) / span) * (1 - FLOOR),
  }));
}

/** Change over the stretch, as a fraction: null with fewer than two points. */
export function rangeChange(points: readonly MarketQuotePoint[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 2) return null;
  return last.close / first.close - 1;
}

/** The column a horizontal position falls on, 0..count-1, for a chart `width` wide; null with nothing to point at. */
export function columnAt(x: number, width: number, count: number): number | null {
  if (count <= 0 || width <= 0) return null;
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

/**
 * The stroke of a filled line chart drawn as columns: for each, where the line's edge starts and how tall it is, in
 * `0..1` of the chart height, so neighbouring columns join into one unbroken line rather than a row of stair
 * steps. A flat stretch is a line at least `minimum` thick.
 */
export function strokeOf(
  ratios: readonly number[],
  index: number,
  minimum: number,
): { readonly bottom: number; readonly height: number } {
  const here = ratios[index] ?? 0;
  const before = ratios[index - 1] ?? here;
  const low = Math.min(here, before);
  const high = Math.max(here, before);
  const height = Math.max(minimum, high - low);
  return { bottom: Math.max(0, high - height), height };
}

/**
 * `count` levels drawn along the whole chart from the few the data has, joined by straight lines between them, so
 * sixty days of closes become a smooth line across a phone's width instead of sixty wide blocks.
 */
export function resampleRatios(ratios: readonly number[], count: number): readonly number[] {
  if (ratios.length === 0 || count <= 0) return [];
  if (ratios.length === 1) return Array.from({ length: count }, () => ratios[0] ?? 0);
  if (count === 1) return [ratios[0] ?? 0];
  return Array.from({ length: count }, (_, column) => {
    const at = (column * (ratios.length - 1)) / (count - 1);
    const low = Math.floor(at);
    const high = Math.min(ratios.length - 1, low + 1);
    const weight = at - low;
    return (ratios[low] ?? 0) * (1 - weight) + (ratios[high] ?? 0) * weight;
  });
}

/** The data point a column stands for, nearest first; 0 when there is nothing to point at. */
export function sourceIndex(column: number, columns: number, points: number): number {
  if (points <= 1 || columns <= 1) return 0;
  return Math.min(points - 1, Math.max(0, Math.round((column * (points - 1)) / (columns - 1))));
}
