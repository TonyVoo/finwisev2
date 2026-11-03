import {
  type CalendarDate,
  calendarDate,
  daysInMonth,
  monthKeyOf,
  monthParts,
  stepMonth,
} from '../lib/calendar';
import type { ExpenseSearch } from '../db/queries';
import type { DatePreset, SavedFilters } from './savedSearches';

/**
 * The search filters beyond text and category: what the person picks (a kind, an amount range, a date preset) and
 * how it becomes a query. Presets rather than a calendar - "last month", "last 3 months" - because that is how
 * people look for things, and because a saved "this month" should mean the month it is opened in.
 */

export function presetRange(
  preset: DatePreset,
  today: CalendarDate,
): { readonly from: CalendarDate; readonly to: CalendarDate } {
  const thisMonth = monthKeyOf(today);
  const lastDay = (key: ReturnType<typeof monthKeyOf>) => {
    const { year, month } = monthParts(key);
    return calendarDate(year, month, daysInMonth(key));
  };
  const firstDay = (key: ReturnType<typeof monthKeyOf>) => {
    const { year, month } = monthParts(key);
    return calendarDate(year, month, 1);
  };
  switch (preset) {
    case 'thisMonth':
      return { from: firstDay(thisMonth), to: lastDay(thisMonth) };
    case 'lastMonth': {
      const last = stepMonth(thisMonth, -1);
      return { from: firstDay(last), to: lastDay(last) };
    }
    case 'last3Months':
      return { from: firstDay(stepMonth(thisMonth, -2)), to: lastDay(thisMonth) };
    case 'thisYear': {
      const { year } = monthParts(thisMonth);
      return { from: calendarDate(year, 1, 1), to: calendarDate(year, 12, 31) };
    }
  }
}

export function toSearch(filters: SavedFilters, today: CalendarDate): ExpenseSearch {
  const range =
    filters.range === undefined || filters.range === null
      ? null
      : presetRange(filters.range, today);
  return {
    text: filters.text,
    categoryId: filters.categoryId,
    kind: filters.kind ?? null,
    minMinor: filters.minMinor ?? null,
    maxMinor: filters.maxMinor ?? null,
    from: range?.from ?? null,
    to: range?.to ?? null,
  };
}

/** How many of the filters behind the Filters button are in use, for its badge. */
export function activeFilterCount(filters: SavedFilters): number {
  return [
    filters.kind ?? null,
    filters.minMinor ?? null,
    filters.maxMinor ?? null,
    filters.range ?? null,
  ].filter((value) => value !== null).length;
}
