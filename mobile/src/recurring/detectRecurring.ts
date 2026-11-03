/**
 * Noticing a payment that repeats every month, from the person's own history (`docs/design/28-recurring-suggestions.md`).
 *
 * A suggestion needs: the same note (or, with no note, the same category) and the **same amount**, in three or more
 * months **in a row**, on about the same day (within three of the middle one), still going (the last payment this month or
 * last), and never twice in one month - that is a habit, not a subscription. A rule that already covers it, or one the
 * person dismissed, is left out. Pure and integer-only; the screen turns a suggestion into a rule only when asked.
 */

export interface HistoryEntry {
  readonly date: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly note: string | null;
  readonly categoryId: string;
}

export interface ExistingRule {
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly note: string | null;
}

export interface RecurringSuggestion {
  /** Stable, so a dismissal sticks. */
  readonly key: string;
  readonly categoryId: string;
  readonly note: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurrences: number;
  readonly lastDate: string;
  /** The first expected payment after today. */
  readonly nextDate: string;
}

const MIN_MONTHS = 3;
const DAY_SPREAD = 3;

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
const dayOf = (date: string) => Number(date.slice(8, 10));
const pad = (n: number) => String(n).padStart(2, '0');

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** `index` months since year 0, on `day` or the month's last day if it is shorter. */
function dateAt(index: number, day: number): string {
  const year = Math.floor(index / 12);
  const month1 = (index % 12) + 1;
  return `${year}-${pad(month1)}-${pad(Math.min(day, daysInMonth(year, month1)))}`;
}

export function detectRecurring(input: {
  readonly history: readonly HistoryEntry[];
  readonly rules: readonly ExistingRule[];
  readonly dismissed: ReadonlySet<string>;
  /** `YYYY-MM-DD`. */
  readonly today: string;
}): readonly RecurringSuggestion[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of input.history) {
    const name = e.note?.trim().toLowerCase() ?? '';
    const key = `${name === '' ? `#${e.categoryId}` : name}|${e.amountMinor}|${e.currency}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [e]);
    else list.push(e);
  }

  const todayIndex = monthIndex(input.today);
  const found: RecurringSuggestion[] = [];

  for (const [key, entries] of groups) {
    if (input.dismissed.has(key)) continue;
    entries.sort((a, b) => a.date.localeCompare(b.date));

    // Two in one month is a habit, not a monthly payment.
    const months = entries.map((e) => monthIndex(e.date));
    if (new Set(months).size !== months.length) continue;

    // The run of consecutive months that ends at the latest payment.
    let start = months.length - 1;
    while (start > 0 && (months[start] ?? 0) - (months[start - 1] ?? 0) === 1) start -= 1;
    const run = entries.slice(start);
    if (run.length < MIN_MONTHS) continue;

    const last = run[run.length - 1];
    if (last === undefined || todayIndex - monthIndex(last.date) > 1) continue;

    const days = run.map((e) => dayOf(e.date)).sort((a, b) => a - b);
    const middle = days[Math.floor(days.length / 2)] ?? 1;
    if (days.some((d) => Math.abs(d - middle) > DAY_SPREAD)) continue;

    const covered = input.rules.some(
      (r) => r.categoryId === last.categoryId && r.amountMinor === last.amountMinor,
    );
    if (covered) continue;

    let next = monthIndex(last.date) + 1;
    while (dateAt(next, middle) <= input.today) next += 1;

    found.push({
      key,
      categoryId: last.categoryId,
      note: last.note?.trim() === '' ? null : (last.note?.trim() ?? null),
      amountMinor: last.amountMinor,
      currency: last.currency,
      occurrences: run.length,
      lastDate: last.date,
      nextDate: dateAt(next, middle),
    });
  }
  return found.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.key.localeCompare(b.key));
}
