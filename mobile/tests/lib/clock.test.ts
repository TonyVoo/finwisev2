import { systemClock, toCalendarDate, toTimestamp } from '@/lib/clock';

describe('toTimestamp', () => {
  it('formats an instant as RFC 3339 with an explicit UTC offset', () => {
    // The format `Timestamp` in the wire contract requires.
    expect(toTimestamp(new Date(Date.UTC(2026, 9, 8, 10, 30, 0, 123)))).toBe(
      '2026-10-08T10:30:00.123Z',
    );
  });
});

describe('toCalendarDate', () => {
  /**
   * The bug this function exists to prevent.
   *
   * `date` is the day the user assigns to an expense, in their own timezone, and monthly
   * totals bucket on it. `toISOString().slice(0, 10)` converts to UTC first, so an
   * expense added late in the evening east of Greenwich lands on the following day - and
   * one added early in the morning west of it lands on the previous one. At a month
   * boundary that moves the expense into the wrong monthly total.
   */
  it('uses the local calendar day, not the UTC one', () => {
    // Constructed from local components, so this assertion holds in every timezone.
    const lateEvening = new Date(2026, 9, 8, 23, 30);
    expect(toCalendarDate(lateEvening)).toBe('2026-10-08');

    const earlyMorning = new Date(2026, 9, 8, 0, 30);
    expect(toCalendarDate(earlyMorning)).toBe('2026-10-08');
  });

  it('pads months and days to two digits so the format sorts lexicographically', () => {
    // Monthly totals group on `substr(date, 1, 7)` and the expense list orders on
    // `date DESC`, both of which need a fixed-width format.
    expect(toCalendarDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toCalendarDate(new Date(2026, 10, 30))).toBe('2026-11-30');
  });

  it('differs from the naive UTC slice at the day boundary', () => {
    // `getTimezoneOffset` is minutes to *add* to local to get UTC, so it is negative
    // east of Greenwich. Pick the side of midnight where local and UTC disagree.
    const offsetMinutes = new Date(2026, 9, 8, 12).getTimezoneOffset();
    if (offsetMinutes === 0) {
      // Under UTC the naive implementation is also correct, so there is nothing here to
      // distinguish. The assertions above still cover the arithmetic.
      expect(toCalendarDate(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08');
      return;
    }

    const at =
      offsetMinutes < 0
        ? new Date(2026, 9, 8, 0, 1) // ahead of UTC: still the 7th in UTC
        : new Date(2026, 9, 8, 23, 59); // behind UTC: already the 9th in UTC

    expect(toCalendarDate(at)).toBe('2026-10-08');
    // The naive `toISOString().slice(0, 10)` lands on the wrong day here, which is the
    // bug this helper exists to prevent.
    expect(at.toISOString().slice(0, 10)).not.toBe('2026-10-08');
  });
});

describe('systemClock', () => {
  it('reads the wall clock', () => {
    const before = Date.now();
    const at = systemClock().getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
