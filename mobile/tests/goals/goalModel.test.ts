import {
  goalProgress,
  monthsUntil,
  neededPerMonth,
  validateDeposit,
  validateGoalDraft,
} from '@/goals/goalModel';

const draft = {
  name: 'Holiday',
  targetText: '1000',
  savedText: '',
  deadlineText: '',
};

describe('goalProgress', () => {
  it('works in integers and rounds the percent down', () => {
    expect(goalProgress(25000, 100000)).toEqual({
      fill: 0.25,
      percent: 25,
      remainingMinor: 75000,
      reached: false,
    });
    // 99.9% is not done.
    expect(goalProgress(99999, 100000).percent).toBe(99);
    expect(goalProgress(99999, 100000).reached).toBe(false);
  });

  it('caps an over-saved goal at a full bar and 100%', () => {
    expect(goalProgress(150000, 100000)).toEqual({
      fill: 1,
      percent: 100,
      remainingMinor: 0,
      reached: true,
    });
  });

  it('is empty at zero', () => {
    expect(goalProgress(0, 100000)).toMatchObject({ fill: 0, percent: 0, reached: false });
  });
});

describe('monthsUntil', () => {
  it('counts a part month as a month', () => {
    expect(monthsUntil('2026-10-27', '2026-11-05')).toBe(1);
    expect(monthsUntil('2026-10-05', '2026-11-20')).toBe(2);
    expect(monthsUntil('2026-10-05', '2026-11-05')).toBe(1);
    expect(monthsUntil('2026-10-27', '2026-10-30')).toBe(1);
  });

  it('crosses a year', () => {
    expect(monthsUntil('2026-10-05', '2027-04-05')).toBe(6);
  });
});

describe('neededPerMonth', () => {
  it('divides what is left by the months left, rounded up', () => {
    expect(
      neededPerMonth({ savedMinor: 0, targetMinor: 100000, deadline: '2027-04-05' }, '2026-10-05'),
    ).toBe(Math.ceil(100000 / 6));
  });

  it('has nothing to say without a deadline, once reached, or after the deadline', () => {
    expect(
      neededPerMonth({ savedMinor: 0, targetMinor: 100, deadline: null }, '2026-10-05'),
    ).toBeNull();
    expect(
      neededPerMonth({ savedMinor: 100, targetMinor: 100, deadline: '2027-01-01' }, '2026-10-05'),
    ).toBeNull();
    expect(
      neededPerMonth({ savedMinor: 0, targetMinor: 100, deadline: '2026-09-01' }, '2026-10-05'),
    ).toBeNull();
  });
});

describe('validateGoalDraft', () => {
  it('accepts a name and a target, with nothing saved and no deadline', () => {
    expect(validateGoalDraft(draft, 2)).toEqual({
      ok: true,
      value: { name: 'Holiday', targetMinor: 100000, savedMinor: 0, deadline: null },
    });
  });

  it('reads saved and deadline when given', () => {
    const result = validateGoalDraft(
      { ...draft, savedText: '250.50', deadlineText: '2027-01-31' },
      2,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { savedMinor: 25050, deadline: '2027-01-31' },
    });
  });

  it('treats a zero saved amount as nothing saved', () => {
    expect(validateGoalDraft({ ...draft, savedText: '0' }, 2)).toMatchObject({
      ok: true,
      value: { savedMinor: 0 },
    });
  });

  it('reports every problem at once', () => {
    const result = validateGoalDraft(
      { name: '  ', targetText: '0', savedText: 'abc', deadlineText: '2026-02-30' },
      2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(['deadline', 'name', 'saved', 'target']);
    }
  });

  it('refuses a name past 60 characters', () => {
    const result = validateGoalDraft({ ...draft, name: 'x'.repeat(61) }, 2);
    expect(result.ok).toBe(false);
  });
});

describe('validateDeposit', () => {
  it('accepts a positive amount in either decimal mark', () => {
    expect(validateDeposit('50', 2)).toEqual({ ok: true, amountMinor: 5000 });
    expect(validateDeposit('12,5', 2)).toEqual({ ok: true, amountMinor: 1250 });
  });

  it.each(['', '0', 'abc', '1.234'])('refuses %j', (text) => {
    expect(validateDeposit(text, 2).ok).toBe(false);
  });
});
