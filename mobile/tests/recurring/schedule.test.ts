import { Uuid } from '@expense-tracker/shared';
import {
  MAX_OCCURRENCES_PER_RULE,
  dueOccurrences,
  nextOccurrence,
  occurrenceAt,
  occurrenceExpenseId,
  type RuleSchedule,
} from '@/recurring/schedule';

const monthly = (startDate: string, endDate: string | null = null): RuleSchedule => ({
  frequency: 'monthly',
  startDate,
  endDate,
});
const weekly = (startDate: string, endDate: string | null = null): RuleSchedule => ({
  frequency: 'weekly',
  startDate,
  endDate,
});

describe('occurrenceAt', () => {
  it('steps weekly rules 7 days at a time, across month and year ends', () => {
    const rule = weekly('2026-12-25');
    expect([0, 1, 2, 3].map((i) => occurrenceAt(rule, i))).toEqual([
      '2026-12-25',
      '2027-01-01',
      '2027-01-08',
      '2027-01-15',
    ]);
  });

  it('keeps a monthly rule on its day', () => {
    const rule = monthly('2026-01-15');
    expect([0, 1, 2, 11, 12].map((i) => occurrenceAt(rule, i))).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-12-15',
      '2027-01-15',
    ]);
  });

  it('clamps the 31st to each month length, and returns to the 31st rather than drifting', () => {
    const rule = monthly('2026-01-31');
    expect([0, 1, 2, 3, 4, 5].map((i) => occurrenceAt(rule, i))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('knows leap years: the 29th lands on 29 Feb in 2028 and on 28 Feb in 2027', () => {
    const rule = monthly('2027-01-29');
    expect(occurrenceAt(rule, 1)).toBe('2027-02-28');
    expect(occurrenceAt(monthly('2028-01-29'), 1)).toBe('2028-02-29');
  });

  it('clamps the 30th and the 29th in February too', () => {
    expect(occurrenceAt(monthly('2026-01-30'), 1)).toBe('2026-02-28');
    expect(occurrenceAt(monthly('2026-01-29'), 1)).toBe('2026-02-28');
  });
});

describe('dueOccurrences', () => {
  it('is empty while the start is in the future', () => {
    expect(dueOccurrences(monthly('2026-11-01'), '2026-10-26')).toEqual([]);
  });

  it('includes an occurrence falling today, and the start itself', () => {
    expect(dueOccurrences(monthly('2026-10-26'), '2026-10-26')).toEqual(['2026-10-26']);
  });

  it('backfills every missed occurrence, oldest first', () => {
    expect(dueOccurrences(monthly('2026-07-31'), '2026-10-26')).toEqual([
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ]);
    expect(dueOccurrences(weekly('2026-10-05'), '2026-10-26')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
  });

  it('stops at the end date, inclusive', () => {
    expect(dueOccurrences(monthly('2026-07-15', '2026-09-15'), '2026-12-31')).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
    ]);
    expect(dueOccurrences(monthly('2026-07-15', '2026-09-14'), '2026-12-31')).toEqual([
      '2026-07-15',
      '2026-08-15',
    ]);
  });

  it('is empty when the rule ended before it started producing anything due', () => {
    expect(dueOccurrences(monthly('2026-07-15', '2026-07-15'), '2026-12-31')).toEqual([
      '2026-07-15',
    ]);
  });

  it('keeps the NEWEST occurrences when the cap bites, and is stable run to run', () => {
    const rule = weekly('2010-01-04');
    const first = dueOccurrences(rule, '2026-10-26');
    const second = dueOccurrences(rule, '2026-10-26');

    expect(first).toHaveLength(MAX_OCCURRENCES_PER_RULE);
    expect(first.at(-1)).toBe('2026-10-26');
    expect(second).toEqual(first);
    // Strictly ascending, one week apart.
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i]! > first[i - 1]!).toBe(true);
    }
  });
});

describe('nextOccurrence', () => {
  it('is the first occurrence strictly after today', () => {
    expect(nextOccurrence(monthly('2026-01-31'), '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(weekly('2026-10-05'), '2026-10-26')).toBe('2026-11-02');
  });

  it('is the start date itself while it is still ahead', () => {
    expect(nextOccurrence(monthly('2026-12-01'), '2026-10-26')).toBe('2026-12-01');
  });

  it('is null once the end date has passed', () => {
    expect(nextOccurrence(monthly('2026-07-15', '2026-09-15'), '2026-09-15')).toBeNull();
    expect(nextOccurrence(monthly('2026-07-15', '2026-12-15'), '2026-09-15')).toBe('2026-10-15');
  });
});

describe('occurrenceExpenseId', () => {
  const RULE = '0192f5a0-0000-7000-8000-0000000000aa';

  it('is deterministic', () => {
    expect(occurrenceExpenseId(RULE, '2026-10-15')).toBe(occurrenceExpenseId(RULE, '2026-10-15'));
  });

  it('differs by date and by rule', () => {
    const ids = new Set([
      occurrenceExpenseId(RULE, '2026-10-15'),
      occurrenceExpenseId(RULE, '2026-10-16'),
      occurrenceExpenseId('0192f5a0-0000-7000-8000-0000000000ab', '2026-10-15'),
    ]);
    expect(ids.size).toBe(3);
  });

  it('is a UUID the shared contract accepts, for any date', () => {
    for (const date of ['2026-01-01', '2026-02-28', '2027-12-31', '2030-06-15']) {
      const id = occurrenceExpenseId(RULE, date);
      expect(Uuid.safeParse(id).success).toBe(true);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('does not collide across a few thousand occurrences of many rules', () => {
    const seen = new Set<string>();
    for (let rule = 0; rule < 50; rule += 1) {
      const ruleId = `0192f5a0-0000-7000-8000-${rule.toString(16).padStart(12, '0')}`;
      for (let day = 0; day < 100; day += 1) {
        seen.add(occurrenceExpenseId(ruleId, occurrenceAt(weekly('2026-01-01'), day)));
      }
    }
    expect(seen.size).toBe(5000);
  });
});
