import type { RecurringFrequency } from '@expense-tracker/shared';
import {
  type CalendarDate,
  calendarDate,
  dateParts,
  daysInMonth,
  monthKey,
  stepDay,
} from '../lib/calendar';

/**
 * When a recurring rule fires. Pure: no clock, no database.
 *
 * Every occurrence is a function of `startDate` and `frequency` alone (`shared/src/
 * recurring.ts`), which is what lets two devices agree on every date a rule has ever
 * produced without agreeing on a cursor.
 *
 * - **weekly**: `startDate`, then every 7 days.
 * - **monthly**: the day-of-month of `startDate`, clamped to the month's length. The clamp
 *   is applied to the *original* day each month, never to the previous occurrence, so a
 *   rule starting on the 31st goes 31 Jan, 28 Feb, 31 Mar, 30 Apr, 31 May - it does not
 *   slide to the 28th for good after February.
 */

export interface RuleSchedule {
  readonly frequency: RecurringFrequency;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate | null;
}

/**
 * The most occurrences one pass will create for one rule. A rule started years ago would
 * otherwise create hundreds of expenses on the next launch, which is a surprise and a long
 * first sync. When the cap bites it is the **most recent** occurrences that are kept, and
 * since the set is recomputed identically every run, the skipped older ones stay skipped
 * rather than trickling in later.
 */
export const MAX_OCCURRENCES_PER_RULE = 366;

/** The `index`th occurrence (0 is `startDate`). */
export function occurrenceAt(rule: RuleSchedule, index: number): CalendarDate {
  if (rule.frequency === 'weekly') return stepDay(rule.startDate, index * 7);

  const { year, month, day } = dateParts(rule.startDate);
  const total = year * 12 + (month - 1) + index;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (((total % 12) + 12) % 12) + 1;
  const length = daysInMonth(monthKey(targetYear, targetMonth));
  return calendarDate(targetYear, targetMonth, Math.min(day, length));
}

/**
 * Every occurrence on or before `today` (and on or before `endDate`), oldest first, newest
 * {@link MAX_OCCURRENCES_PER_RULE} at most. Empty while `startDate` is still in the future.
 *
 * Dates compare as text: they are zero-padded `YYYY-MM-DD`.
 */
export function dueOccurrences(
  rule: RuleSchedule,
  today: CalendarDate,
  cap: number = MAX_OCCURRENCES_PER_RULE,
): readonly CalendarDate[] {
  const limit = rule.endDate !== null && rule.endDate < today ? rule.endDate : today;
  if (rule.startDate > limit) return [];

  const due: CalendarDate[] = [];
  // Bounded by the loop guard as well as the date: a corrupt rule must not spin forever.
  for (let index = 0; index < 100_000; index += 1) {
    const date = occurrenceAt(rule, index);
    if (date > limit) break;
    due.push(date);
  }
  return due.length > cap ? due.slice(due.length - cap) : due;
}

/**
 * The next occurrence strictly after `today`, or null when the rule has ended - what the
 * list shows as "Next: ...".
 */
export function nextOccurrence(rule: RuleSchedule, today: CalendarDate): CalendarDate | null {
  for (let index = 0; index < 100_000; index += 1) {
    const date = occurrenceAt(rule, index);
    if (rule.endDate !== null && date > rule.endDate) return null;
    if (date > today) return date;
  }
  return null;
}

/**
 * The id of the expense a rule creates for one date.
 *
 * Deterministic, so two devices generating the same occurrence create the **same row** and
 * sync converges instead of duplicating it. It is a 128-bit non-cryptographic hash (cyrb128)
 * of `ruleId|date`, shaped as a version-5 UUID so the server's UUID check accepts it. Not
 * a security boundary: nothing trusts an id to be unguessable, only unique, and 128 bits
 * makes an accidental collision across every account a non-event.
 */
export function occurrenceExpenseId(ruleId: string, date: CalendarDate): string {
  const [a, b, c, d] = cyrb128(`${ruleId}|${date}`);
  const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, '0')).join('');
  // 8-4-4-4-12, with the version nibble forced to 5 and the variant to 10xx.
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** cyrb128 (public domain): a fast 128-bit string hash as four unsigned 32-bit words. */
function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i += 1) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
