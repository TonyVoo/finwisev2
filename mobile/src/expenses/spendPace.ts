/** The Home header's maths, kept apart from the component so it can be tested plainly. */

export interface DailySpend {
  readonly date: string;
  readonly totalMinor: number;
}

/**
 * Running spend for days 1..`days` of a month. Quiet days carry the previous total, so the
 * line only ever rises or stays flat. Rows outside the range are ignored.
 */
export function cumulativeSeries(
  rows: readonly DailySpend[],
  month: string,
  days: number,
): number[] {
  const perDay = new Array<number>(days).fill(0);
  for (const row of rows) {
    if (!row.date.startsWith(`${month}-`)) continue;
    const day = Number(row.date.slice(8, 10));
    if (day >= 1 && day <= days) perDay[day - 1] = (perDay[day - 1] ?? 0) + row.totalMinor;
  }
  let running = 0;
  return perDay.map((amount) => (running += amount));
}

/**
 * Where the month ends if the days so far are typical: the daily average times the month's
 * length. `null` when there is nothing to extrapolate from.
 */
export function projectedMonthEnd(
  spentMinor: number,
  daysElapsed: number,
  daysInMonth: number,
): number | null {
  if (spentMinor <= 0 || daysElapsed <= 0) return null;
  return Math.round((spentMinor / daysElapsed) * daysInMonth);
}
