import {
  calendarDate,
  currentMonthKey,
  dateRowLabel,
  dayLabel,
  daysInMonth,
  isFutureDate,
  isFutureMonth,
  monthKeyOf,
  monthLabel,
  monthRange,
  monthShortLabel,
  spokenDate,
  stepDay,
  stepMonth,
  todayCalendarDate,
} from '@/lib/calendar';

/**
 * Covers `src/lib/calendar.ts`.
 *
 * Two things are under test and they fail differently. The **arithmetic** (bounds,
 * stepping, membership) is pure string and integer work and is asserted exactly. The
 * **labels** go through `Intl`, so what is asserted about them is the property the design
 * relies on - that a calendar date keeps its day and its month name whatever zone the
 * device is in - rather than a literal string, which is a property of the locale and would
 * give two testers two verdicts (`tests/lib/currencyFormatting.test.ts`, EDGE-15).
 *
 * `en-GB` is passed wherever a literal *is* asserted, so the assertion is about this
 * module and not about the test runner's default locale.
 */

/**
 * The two zones `SUM-02` runs in: the far side of the date line in both directions.
 *
 * **What a green run in these zones does and does not prove.** Assigning `process.env.TZ`
 * after a process has already read a date is not reliable - V8 caches the zone per isolate
 * - so a case below that passes "in Pacific/Niue" may well have run in the suite's own
 * zone. These cases are still worth having, because what they asserted is that the result
 * does not vary: every one of them is over an API that takes no local reading at all
 * (string bounds, or a UTC instant formatted in UTC). The zone-sensitivity of the one
 * function that *does* read the device clock is pinned structurally instead, by passing
 * locally-constructed instants. `SUM-02` on a real device is what measures the rest.
 */
const KIRITIMATI = 'Pacific/Kiritimati'; // UTC+14
const NIUE = 'Pacific/Niue'; // UTC-11

describe('month bounds', () => {
  it('is the inclusive first-to-last day pair', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('gets February right in a leap year and in a century that is not one', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2000-02')).toBe(29);
  });

  /**
   * `SUM-02`. The bounds are compared as strings, so the four boundary dates fall on the
   * same side of October in every zone. A `Date`-based implementation would move the ones
   * at the edges.
   */
  it.each([KIRITIMATI, NIUE])('bounds the same days in %s', (timeZone) => {
    const original = process.env.TZ;
    process.env.TZ = timeZone;
    try {
      const { from, to } = monthRange('2026-10');
      const inside = ['2026-10-01', '2026-10-31'].every((date) => date >= from && date <= to);
      const outside = ['2026-09-30', '2026-11-01'].every((date) => date < from || date > to);

      expect(from).toBe('2026-10-01');
      expect(to).toBe('2026-10-31');
      expect(inside).toBe(true);
      expect(outside).toBe(true);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('stepping a month', () => {
  it('steps within a year', () => {
    expect(stepMonth('2026-10', 1)).toBe('2026-11');
    expect(stepMonth('2026-10', -1)).toBe('2026-09');
  });

  // `05-month-switcher.md` rule 1: the year follows automatically.
  it('carries and borrows across the year boundary', () => {
    expect(stepMonth('2026-12', 1)).toBe('2027-01');
    expect(stepMonth('2026-01', -1)).toBe('2025-12');
    expect(stepMonth('2026-01', -13)).toBe('2024-12');
    expect(stepMonth('2026-01', 23)).toBe('2027-12');
  });

  // Rule 3: there is no lower bound, so a long walk back has to stay well-formed.
  it('stays a zero-padded key arbitrarily far back', () => {
    expect(stepMonth('2026-03', -300)).toBe('2001-03');
    expect(monthKeyOf(`${stepMonth('2026-03', -300)}-01`)).toBe('2001-03');
  });
});

describe('stepping a day', () => {
  it('crosses months and years', () => {
    expect(stepDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(stepDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(stepDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses the end of February in both kinds of year', () => {
    expect(stepDay('2024-02-28', 1)).toBe('2024-02-29');
    expect(stepDay('2026-02-28', 1)).toBe('2026-03-01');
  });

  /**
   * The DST trap: 2026-03-29 is the UK spring-forward day, where a local-midnight
   * `Date` plus 24 hours lands at 01:00 on the same date. The arithmetic is in UTC, so
   * the day still advances.
   */
  it('advances a day across a DST transition', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      expect(stepDay('2026-03-29', 1)).toBe('2026-03-30');
      expect(stepDay('2026-10-25', 1)).toBe('2026-10-26');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('today, and the future', () => {
  /**
   * `todayCalendarDate` reads the *local* calendar deliberately: "today" is the only
   * question in this module whose answer depends on where the device is.
   *
   * The instants here are built from **local** components, so the assertion holds in any
   * zone the suite runs in. Switching `process.env.TZ` mid-run would be the more direct
   * test and is not reliable: V8 caches the zone per isolate, so the second assignment in
   * a process that has already read a date is silently ignored.
   *
   * What it does pin is the part that would break: a late-evening local time keeps the
   * local day, which `toISOString().slice(0, 10)` would advance east of Greenwich.
   */
  it('reads the device calendar day from local components', () => {
    expect(todayCalendarDate(new Date(2026, 9, 8, 23, 30))).toBe('2026-10-08');
    expect(todayCalendarDate(new Date(2026, 9, 9, 0, 15))).toBe('2026-10-09');
    expect(todayCalendarDate(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02');
    expect(currentMonthKey(new Date(2026, 9, 8, 23, 30))).toBe('2026-10');
    expect(currentMonthKey(new Date(2025, 11, 31, 23, 59))).toBe('2025-12');
  });

  /**
   * The same instant, read the wrong way. `toISOString()` converts to UTC first, so for
   * any device whose offset is positive a late-evening write lands on the following day -
   * the bug `06-expense-form.md` rule 7 calls the most likely date bug in this app. The
   * case asserts the two disagree *when the offset puts them on different days*, and is a
   * no-op in a zone where it cannot.
   */
  it('does not agree with the UTC date when the local offset crosses midnight', () => {
    const lateLocalEvening = new Date(2026, 9, 8, 23, 30);
    const utcDay = lateLocalEvening.toISOString().slice(0, 10);

    if (utcDay !== '2026-10-08') {
      expect(todayCalendarDate(lateLocalEvening)).not.toBe(utcDay);
    }
    expect(todayCalendarDate(lateLocalEvening)).toBe('2026-10-08');
  });

  it('calls a later month future and the current one not', () => {
    expect(isFutureMonth('2026-11', '2026-10-09')).toBe(true);
    expect(isFutureMonth('2026-10', '2026-10-09')).toBe(false);
    expect(isFutureMonth('2026-10', '2026-10-31')).toBe(false);
    expect(isFutureMonth('2026-09', '2026-10-09')).toBe(false);
    expect(isFutureMonth('2027-01', '2026-12-31')).toBe(true);
  });

  it('calls tomorrow future and today not', () => {
    expect(isFutureDate('2026-10-10', '2026-10-09')).toBe(true);
    expect(isFutureDate('2026-10-09', '2026-10-09')).toBe(false);
    expect(isFutureDate('2026-10-08', '2026-10-09')).toBe(false);
  });
});

describe('day labels', () => {
  const today = '2026-10-09';

  it('names today and yesterday relatively', () => {
    expect(dayLabel(today, today)).toBe('Today');
    expect(dayLabel('2026-10-08', today)).toBe('Yesterday');
  });

  // `SUM-03`: the relative words are computed against the local calendar day, and the
  // first of a month is yesterday's neighbour across the month boundary.
  it('names yesterday across a month boundary', () => {
    expect(dayLabel('2026-09-30', '2026-10-01')).toBe('Yesterday');
    expect(dayLabel('2025-12-31', '2026-01-01')).toBe('Yesterday');
  });

  /**
   * `EEE d MMM` with no comma, which is not what `Intl` hands back: `en-GB` renders this
   * field set as `Sun, 4 Oct`. 2026-10-04 is a Sunday - the design's own example reads
   * `Mon 4 Oct`, which is the format rather than this date.
   */
  it('writes an older day as EEE d MMM, in sentence case and without a separator', () => {
    expect(dayLabel('2026-10-04', today, 'en-GB')).toBe('Sun 4 Oct');
    expect(dayLabel('2026-10-05', today, 'en-GB')).toBe('Mon 5 Oct');
    expect(dayLabel('2026-10-04', today, 'en-GB')).not.toMatch(/[A-Z]{2}/);
  });

  // Rule 2: a date in a different calendar year gets its year, because `Mon 4 Oct` alone
  // would read as this year's.
  it('adds the year for another calendar year', () => {
    expect(dayLabel('2025-10-06', today, 'en-GB')).toBe('Mon 6 Oct 2025');
  });

  /**
   * The label of a stored date must not depend on where the phone is. A formatter run over
   * a local-midnight `Date` would name 2026-10-01 "Wed 30 Sep" in UTC-11.
   */
  it.each([KIRITIMATI, NIUE])('names the same day in %s', (timeZone) => {
    const original = process.env.TZ;
    process.env.TZ = timeZone;
    try {
      expect(dayLabel('2026-10-01', '2026-10-09', 'en-GB')).toBe('Thu 1 Oct');
      expect(spokenDate('2026-10-01', 'en-GB')).toBe('1 October 2026');
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('the form date row', () => {
  const today = '2026-10-09';

  it('prefers the relative word, then the full date with its year', () => {
    expect(dateRowLabel(today, today)).toBe('Today');
    expect(dateRowLabel('2026-10-08', today)).toBe('Yesterday');
    expect(dateRowLabel('2026-10-04', today, 'en-GB')).toBe('Sun 4 Oct 2026');
  });
});

describe('month labels', () => {
  it('writes the bar label as MMMM yyyy and the grid cell as MMM', () => {
    expect(monthLabel('2026-10', 'en-GB')).toBe('October 2026');
    expect(monthShortLabel('2026-10', 'en-GB')).toBe('Oct');
    expect(monthShortLabel('2026-01', 'en-GB')).toBe('Jan');
  });

  /**
   * The label names the month the key says, in every zone. The first of a month formatted
   * from a local-midnight `Date` is the previous month west of Greenwich.
   */
  it.each([KIRITIMATI, NIUE])('names the month the key carries in %s', (timeZone) => {
    const original = process.env.TZ;
    process.env.TZ = timeZone;
    try {
      expect(monthLabel('2026-10', 'en-GB')).toBe('October 2026');
      expect(monthLabel('2026-01', 'en-GB')).toBe('January 2026');
    } finally {
      process.env.TZ = original;
    }
  });

  it('localises the month name rather than hardcoding English', () => {
    expect(monthLabel('2026-10', 'fr-FR')).toBe('octobre 2026');
  });
});

describe('building a date from picker components', () => {
  it('zero-pads every part', () => {
    expect(calendarDate(2026, 1, 2)).toBe('2026-01-02');
    expect(calendarDate(2026, 12, 31)).toBe('2026-12-31');
    expect(calendarDate(876, 3, 4)).toBe('0876-03-04');
  });
});
