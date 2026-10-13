/**
 * Calendar arithmetic on the zone-less `YYYY-MM-DD` strings the app stores.
 *
 * An expense's `date` is "the day the user assigned to it" and must not shift across
 * timezones (`docs/PLAN.md` §Data model). Everything here therefore works on the string
 * and on integers pulled out of it, never on a local `Date`:
 *
 * - **Month membership and ordering are string comparisons.** A month is the inclusive
 *   pair `[YYYY-MM-01, YYYY-MM-LL]` and both bounds are zero-padded, so `<=` on the text
 *   *is* a date comparison (`05-month-switcher.md` rule 11). No parsing, nothing to get
 *   wrong at UTC+14.
 * - **`Date` appears in exactly two shapes.** Reading *today* off the device clock, which
 *   is the one place a local calendar is the right answer, and building a UTC instant to
 *   hand to `Intl.DateTimeFormat` purely so it can name a month or a weekday. A UTC
 *   instant formatted in UTC cannot land on a neighbouring day.
 * - **`toISOString().slice(0, 10)` appears nowhere.** It converts to UTC first, which is
 *   the single most likely date bug in this app (`06-expense-form.md` rule 7).
 */

/** A calendar date, `YYYY-MM-DD`. Matches `CalendarDate` in the contract. */
export type CalendarDate = string;

/** A month bucket, `YYYY-MM`. Lexicographically sortable, like the dates inside it. */
export type MonthKey = string;

/** The inclusive date range of one month, as the bounds a query binds. */
export interface MonthRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

interface DateParts {
  readonly year: number;
  /** 1-12, as a human writes it rather than as `Date` numbers months. */
  readonly month: number;
  readonly day: number;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function pad4(value: number): string {
  return value.toString().padStart(4, '0');
}

/**
 * Build a `YYYY-MM-DD` from calendar components the way the date picker reports them.
 *
 * This is the only way a picked date becomes a stored date: the picker gives local
 * year/month/day and they are formatted as-is (`06-expense-form.md` rule 7).
 */
export function calendarDate(year: number, month: number, day: number): CalendarDate {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Today in the device's local calendar - the one question only the local zone answers. */
export function todayCalendarDate(at: Date): CalendarDate {
  return calendarDate(at.getFullYear(), at.getMonth() + 1, at.getDate());
}

export function dateParts(date: CalendarDate): DateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** The month a date falls in. A slice, because the string is already bucketed by month. */
export function monthKeyOf(date: CalendarDate): MonthKey {
  return date.slice(0, 7);
}

export function monthKey(year: number, month: number): MonthKey {
  return `${pad4(year)}-${pad2(month)}`;
}

export function monthParts(key: MonthKey): { readonly year: number; readonly month: number } {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

/** The month containing `at` in the device's local calendar. */
export function currentMonthKey(at: Date): MonthKey {
  return monthKey(at.getFullYear(), at.getMonth() + 1);
}

/**
 * How many days a month has.
 *
 * `Date.UTC(year, month, 0)` is "day zero of the next month", i.e. the last day of this
 * one, and it handles leap years and the February of 1900-style edge years for free. It
 * is UTC, so the device zone cannot move it.
 */
export function daysInMonth(key: MonthKey): number {
  const { year, month } = monthParts(key);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The inclusive `[first, last]` day pair a month query binds. */
export function monthRange(key: MonthKey): MonthRange {
  const { year, month } = monthParts(key);
  return { from: calendarDate(year, month, 1), to: calendarDate(year, month, daysInMonth(key)) };
}

/**
 * Step `delta` calendar months. The year follows automatically, so stepping back from
 * `2026-01` reaches `2025-12` (`05-month-switcher.md` rule 1).
 */
export function stepMonth(key: MonthKey, delta: number): MonthKey {
  const { year, month } = monthParts(key);
  // Months as a single zero-based count, so the division does the carry in both
  // directions. `Math.floor` is what makes a negative step borrow from the year.
  const total = year * 12 + (month - 1) + delta;
  return monthKey(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1);
}

/** Shift a date by whole days, in UTC so no zone can add or drop an hour. */
export function stepDay(date: CalendarDate, delta: number): CalendarDate {
  const { year, month, day } = dateParts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return calendarDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * A month beyond the one `today` falls in.
 *
 * Both keys are zero-padded `YYYY-MM`, so this is a string comparison. Used to disable
 * Next on the switcher: every future month is guaranteed empty, because an expense cannot
 * be dated in the future either (`05-month-switcher.md` rule 2).
 */
export function isFutureMonth(key: MonthKey, today: CalendarDate): boolean {
  return key > monthKeyOf(today);
}

/** A date after today. The picker's `maximumDate` is today (`06-expense-form.md` rule 9). */
export function isFutureDate(date: CalendarDate, today: CalendarDate): boolean {
  return date > today;
}

/**
 * An instant that formats back to `date` under `timeZone: 'UTC'`.
 *
 * Only `Intl` consumers get this: naming a weekday or a month is the one thing the string
 * cannot do by itself. Keeping the instant and the formatter both in UTC is what stops the
 * device zone from renaming `2026-10-01` as the last day of September.
 */
function utcInstant(date: CalendarDate): Date {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(
  date: CalendarDate,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utcInstant(date));
}

/**
 * The same, with the separator `Intl` puts after a weekday removed: `en-GB` renders
 * `weekday, day month` as `Mon, 4 Oct` and the design's format is `EEE d MMM`
 * (`04-expense-list.md` rule 2). Dropping the comma is a smaller deviation than
 * assembling the parts by hand, which would also be fixing the field *order* to
 * English's and so would mis-render every locale that puts the day first.
 */
function formatDayWithWeekday(
  date: CalendarDate,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return formatDate(date, options, locale).replace(/,/g, '');
}

/** `MMMM yyyy`, e.g. `October 2026` - the month switcher's bar label. */
export function monthLabel(key: MonthKey, locale?: string): string {
  return formatDate(`${key}-01`, { month: 'long', year: 'numeric' }, locale);
}

/** `MMM`, e.g. `Oct` - a cell in the month picker grid. */
export function monthShortLabel(key: MonthKey, locale?: string): string {
  return formatDate(`${key}-01`, { month: 'short' }, locale);
}

/** `{MonthName} {Year}` for a month cell's accessibility label. Same text as the bar. */
export function monthSpokenLabel(key: MonthKey, locale?: string): string {
  return monthLabel(key, locale);
}

/**
 * A list section header: `Today`, `Yesterday`, or `EEE d MMM`
 * (`04-expense-list.md` rule 2). A date in another calendar year keeps its year, because
 * `Mon 4 Oct` alone would read as this year's.
 *
 * Sentence case, not uppercase, and computed against the device's local calendar day -
 * which is what `today` carries in.
 */
export function dayLabel(date: CalendarDate, today: CalendarDate, locale?: string): string {
  if (date === today) return 'Today';
  if (date === stepDay(today, -1)) return 'Yesterday';

  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return formatDayWithWeekday(
    date,
    sameYear
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
    locale,
  );
}

/**
 * The expense form's Date row value: `Today` / `Yesterday` / `EEE d MMM yyyy`
 * (`06-expense-form.md` element 7). The year is always present here - unlike a list
 * header, this row is the only place the chosen date is shown.
 */
export function dateRowLabel(date: CalendarDate, today: CalendarDate, locale?: string): string {
  if (date === today) return 'Today';
  if (date === stepDay(today, -1)) return 'Yesterday';
  return formatDayWithWeekday(
    date,
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
    locale,
  );
}

/**
 * The spoken form of a date, e.g. `6 October 2026`.
 *
 * The Date row reads `Date, Today, 6 October 2026`: the relative word is what the user
 * sees, and the absolute date is what makes it unambiguous read aloud
 * (`06-expense-form.md` element 7).
 */
export function spokenDate(date: CalendarDate, locale?: string): string {
  return formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' }, locale);
}
