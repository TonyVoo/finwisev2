import { META_KEYS, WIPED_META_KEYS, writeMeta } from '@/db/meta';
import { migrate } from '@/db/migrations';
import {
  MAX_PLANS,
  lotsFor,
  nextBuyDate,
  readPlans,
  removePlan,
  savePlan,
  upcomingBuyDates,
} from '@/invest/dca';
import { planDcaReminders } from '@/invest/dcaReminders';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

describe('plans', () => {
  it('saves one plan per symbol, newest first, replacing it, and removes by id', async () => {
    await savePlan(database, { symbol: 'vnm', amount: 5_000_000, day: 5 });
    await savePlan(database, { symbol: 'FPT', amount: 3_000_000, day: 10 });
    const list = await savePlan(database, { symbol: 'VNM', amount: 6_000_000, day: 6 });

    expect(list.map((p) => [p.symbol, p.amount, p.day])).toEqual([
      ['FPT', 3_000_000, 10],
      ['VNM', 6_000_000, 6],
    ]);
    expect((await removePlan(database, list[0]!.id)).map((p) => p.symbol)).toEqual(['VNM']);
  });

  it('keeps the place and id of a plan being edited', async () => {
    await savePlan(database, { symbol: 'AAA', amount: 1_000_000, day: 1 });
    await savePlan(database, { symbol: 'BBB', amount: 1_000_000, day: 2 });
    const [first] = await readPlans(database);

    const list = await savePlan(database, { symbol: 'BBB', amount: 2_000_000, day: 3 }, first!.id);

    expect(list.map((p) => p.symbol)).toEqual(['BBB', 'AAA']);
    expect(list[0]).toMatchObject({ id: first!.id, amount: 2_000_000, day: 3 });
  });

  it.each([
    [{ symbol: 'a-b', amount: 1, day: 5 }],
    [{ symbol: 'VNM', amount: 0, day: 5 }],
    [{ symbol: 'VNM', amount: 1.5, day: 5 }],
    [{ symbol: 'VNM', amount: 1_000_000, day: 0 }],
    [{ symbol: 'VNM', amount: 1_000_000, day: 29 }],
  ])('ignores %j', async (input) => {
    expect(await savePlan(database, input)).toEqual([]);
  });

  it('caps the list, reads damaged storage as empty and is a device preference', async () => {
    for (let i = 0; i < MAX_PLANS + 2; i += 1)
      await savePlan(database, { symbol: `S${i}`, amount: 1000, day: 1 });
    expect(await readPlans(database)).toHaveLength(MAX_PLANS);
    await writeMeta(database, META_KEYS.dcaPlans, '{nope');
    expect(await readPlans(database)).toEqual([]);
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.dcaPlans);
  });
});

describe('dates', () => {
  it('falls on this month if the day has not passed, today included, else next month', () => {
    expect(nextBuyDate({ day: 5 }, '2026-11-03')).toBe('2026-11-05');
    expect(nextBuyDate({ day: 5 }, '2026-11-05')).toBe('2026-11-05');
    expect(nextBuyDate({ day: 5 }, '2026-11-06')).toBe('2026-12-05');
  });

  it('rolls over a year', () => {
    expect(nextBuyDate({ day: 5 }, '2026-12-20')).toBe('2027-01-05');
    expect(upcomingBuyDates({ day: 28 }, '2026-11-29', 3)).toEqual([
      '2026-12-28',
      '2027-01-28',
      '2027-02-28',
    ]);
  });
});

describe('what an amount buys', () => {
  it('buys whole lots of 100, fee included, and says what is left', () => {
    const lots = lotsFor(50_000_000, 56_800);
    expect(lots.shares).toBe(800);
    expect(lots.cost).toBe(Math.round(800 * 56_800 * 1.0015));
    expect(lots.leftover).toBe(50_000_000 - lots.cost);
    expect(lots.cost).toBeLessThanOrEqual(50_000_000);
  });

  it('never spends more than the amount, even when the fee tips it over', () => {
    // 100 shares at 50.000 is 5.000.000 before the fee: not affordable with it.
    expect(lotsFor(5_000_000, 50_000).shares).toBe(0);
    expect(lotsFor(5_007_500, 50_000).shares).toBe(100);
  });

  it('buys nothing without a price or an amount', () => {
    expect(lotsFor(5_000_000, 0)).toEqual({ shares: 0, cost: 0, leftover: 5_000_000 });
    expect(lotsFor(0, 50_000).shares).toBe(0);
  });
});

describe('reminders', () => {
  const plan = { id: 'p1', symbol: 'VNM', amount: 5_000_000, day: 5 };

  it('lists the next three months at 09:00 local, none already past', () => {
    const reminders = planDcaReminders([plan], new Date(2026, 10, 3, 8, 0));
    expect(reminders.map((r) => r.id)).toEqual([
      'dca-reminder:p1:2026-11-05',
      'dca-reminder:p1:2026-12-05',
      'dca-reminder:p1:2027-01-05',
    ]);
    expect(reminders[0]?.at.getHours()).toBe(9);

    const late = planDcaReminders([plan], new Date(2026, 10, 5, 10, 0));
    expect(late.map((r) => r.id)).toEqual([
      'dca-reminder:p1:2026-12-05',
      'dca-reminder:p1:2027-01-05',
      'dca-reminder:p1:2027-02-05',
    ]);
  });

  it('names the stock and the amount', () => {
    const [first] = planDcaReminders([plan], new Date(2026, 10, 3, 8, 0));
    expect(first?.title).toContain('VNM');
    expect(first?.body).toMatch(/5[.,]000[.,]000/);
  });
});
