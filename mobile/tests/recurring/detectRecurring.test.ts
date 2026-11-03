import { detectRecurring, type HistoryEntry } from '@/recurring/detectRecurring';

const NETFLIX = 'cat-fun';
const entry = (
  date: string,
  amountMinor = 260000,
  extra: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  date,
  amountMinor,
  currency: 'VND',
  note: 'Netflix',
  categoryId: NETFLIX,
  ...extra,
});
const base = { rules: [], dismissed: new Set<string>(), today: '2026-11-03' };

describe('noticing a payment that repeats every month', () => {
  it('suggests a rule after three months in a row, on about the same day, for the same amount', () => {
    const found = detectRecurring({
      ...base,
      history: [entry('2026-08-05'), entry('2026-09-05'), entry('2026-10-06')],
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      note: 'Netflix',
      amountMinor: 260000,
      categoryId: NETFLIX,
      occurrences: 3,
      lastDate: '2026-10-06',
      // The 5th, the middle of 5, 5 and 6: the next one after today.
      nextDate: '2026-11-05',
    });
  });

  it('needs three months, not two', () => {
    expect(
      detectRecurring({ ...base, history: [entry('2026-09-05'), entry('2026-10-05')] }),
    ).toEqual([]);
  });

  it('needs the months to run on without a gap', () => {
    expect(
      detectRecurring({
        ...base,
        history: [entry('2026-06-05'), entry('2026-08-05'), entry('2026-10-05')],
      }),
    ).toEqual([]);
  });

  it('does not suggest what stopped: the last payment must be this month or last', () => {
    expect(
      detectRecurring({
        ...base,
        history: [entry('2026-05-05'), entry('2026-06-05'), entry('2026-07-05')],
      }),
    ).toEqual([]);
  });

  it('wants the same amount each time, since a varying bill is not a fixed rule', () => {
    expect(
      detectRecurring({
        ...base,
        history: [
          entry('2026-08-05', 250000),
          entry('2026-09-05', 260000),
          entry('2026-10-05', 270000),
        ],
      }),
    ).toEqual([]);
  });

  it('wants about the same day of the month', () => {
    expect(
      detectRecurring({
        ...base,
        history: [entry('2026-08-02'), entry('2026-09-15'), entry('2026-10-27')],
      }),
    ).toEqual([]);
  });

  it('does not mistake a daily habit for a monthly one: two in one month rules it out', () => {
    expect(
      detectRecurring({
        ...base,
        history: [
          entry('2026-08-05'),
          entry('2026-08-20'),
          entry('2026-09-05'),
          entry('2026-10-05'),
        ],
      }),
    ).toEqual([]);
  });

  it('groups by note when there is one, and by category when there is not (this month’s 1st has passed, so the next is December’s)', () => {
    const rent = (date: string) => entry(date, 5000000, { note: null, categoryId: 'cat-rent' });
    const found = detectRecurring({
      ...base,
      history: [rent('2026-08-01'), rent('2026-09-01'), rent('2026-10-01')],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ note: null, categoryId: 'cat-rent', nextDate: '2026-12-01' });
  });

  it('keeps names apart: two subscriptions of one price are two suggestions', () => {
    const history = [
      ...['2026-08-05', '2026-09-05', '2026-10-05'].map((d) => entry(d)),
      ...['2026-08-12', '2026-09-12', '2026-10-12'].map((d) =>
        entry(d, 260000, { note: 'Spotify' }),
      ),
    ];
    expect(
      detectRecurring({ ...base, history })
        .map((s) => s.note)
        .sort(),
    ).toEqual(['Netflix', 'Spotify']);
  });

  it('leaves out what a rule already covers, and what was dismissed', () => {
    const history = [entry('2026-08-05'), entry('2026-09-05'), entry('2026-10-05')];
    expect(
      detectRecurring({
        ...base,
        history,
        rules: [{ categoryId: NETFLIX, amountMinor: 260000, note: 'Netflix' }],
      }),
    ).toEqual([]);

    const [one] = detectRecurring({ ...base, history });
    expect(detectRecurring({ ...base, history, dismissed: new Set([one!.key]) })).toEqual([]);
  });

  it('clamps a 31st to a shorter month, and crosses a year end', () => {
    const found = detectRecurring({
      ...base,
      today: '2027-01-02',
      history: [entry('2026-10-31'), entry('2026-11-30'), entry('2026-12-31')],
    });
    expect(found[0]?.nextDate).toBe('2027-01-31');
    const feb = detectRecurring({
      ...base,
      today: '2027-02-02',
      history: [entry('2026-11-30'), entry('2026-12-31'), entry('2027-01-31')],
    });
    expect(feb[0]?.nextDate).toBe('2027-02-28');
  });
});
