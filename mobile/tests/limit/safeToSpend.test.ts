import { safeToSpend } from '@/limit/safeToSpend';

describe('what is safe to spend today', () => {
  it('divides what is left by the days left, counting today', () => {
    // 3 000 000 limit, 1 200 000 spent, day 10 of 30: 1 800 000 over 21 days.
    expect(
      safeToSpend({ limitMinor: 3000000, spentMinor: 1200000, dayOfMonth: 10, daysInMonth: 30 }),
    ).toEqual({ kind: 'left', perDayMinor: 85714, remainingMinor: 1800000, daysLeft: 21 });
  });

  it('rounds down, so following it never overspends', () => {
    expect(
      safeToSpend({ limitMinor: 1000, spentMinor: 0, dayOfMonth: 1, daysInMonth: 30 }),
    ).toMatchObject({ kind: 'left', perDayMinor: 33 });
  });

  it('on the last day, the whole remainder is today’s', () => {
    expect(
      safeToSpend({ limitMinor: 100000, spentMinor: 40000, dayOfMonth: 30, daysInMonth: 30 }),
    ).toMatchObject({ kind: 'left', perDayMinor: 60000, daysLeft: 1 });
  });

  it('says how far over once the limit is passed', () => {
    expect(
      safeToSpend({ limitMinor: 100000, spentMinor: 130000, dayOfMonth: 12, daysInMonth: 30 }),
    ).toEqual({ kind: 'over', overMinor: 30000 });
  });

  it('spending exactly the limit leaves nothing to spend, but is not over', () => {
    expect(
      safeToSpend({ limitMinor: 100000, spentMinor: 100000, dayOfMonth: 12, daysInMonth: 30 }),
    ).toMatchObject({ kind: 'left', perDayMinor: 0, remainingMinor: 0 });
  });
});
