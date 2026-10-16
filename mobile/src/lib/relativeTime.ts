import { RELATIVE_TIME_COPY } from '../copy/strings';

/**
 * `Last synced {relative}` - the only relative time in the app
 * (`docs/design/09-copy-deck.md` §5).
 *
 * The thresholds are the deck's, and the two rules worth stating are the ones a naive
 * implementation gets wrong:
 *
 * - **A negative interval renders `just now`, never a future time.** A device whose clock
 *   moved backwards - a manual change, an NTP correction after a cold boot - would
 *   otherwise be told its expenses sync `in 3 hours`, which is nonsense about something
 *   that already happened. The deck says so explicitly.
 * - **Each unit is floored, not rounded.** 119 minutes is `1 hour ago`, because claiming
 *   `2 hours ago` would place the sync further in the past than it was, and a sync
 *   indicator that overstates its own staleness invites a pull-to-refresh the user does
 *   not need.
 *
 * Formatted in the device's local zone, unlike everything in `calendar.ts`: this is an
 * instant, not the calendar date a user assigned to an expense.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function fill(template: string, count: number): string {
  return template.replace('{n}', String(count));
}

export function relativeTime(at: Date, now: Date, locale?: string): string {
  const elapsed = now.getTime() - at.getTime();
  const copy = RELATIVE_TIME_COPY;

  if (elapsed < MINUTE_MS) return copy.justNow;

  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return minutes === 1 ? copy.minuteAgo : fill(copy.minutesAgo, minutes);
  }

  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return hours === 1 ? copy.hourAgo : fill(copy.hoursAgo, hours);
  }

  if (elapsed < WEEK_MS) {
    const days = Math.floor(elapsed / DAY_MS);
    return days === 1 ? copy.dayAgo : fill(copy.daysAgo, days);
  }

  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at);
  return copy.onDate.replace('{date}', date);
}
