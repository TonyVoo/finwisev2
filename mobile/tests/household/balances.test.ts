import {
  computeBalances,
  expenseShares,
  suggestTransfers,
  type BalanceExpense,
  type BalanceInput,
  type BalanceMember,
  type BalancePayment,
} from '@/household/balances';

/**
 * Who owes whom, from the rows a phone already holds (`docs/design/12-settle-up.md`). Pure
 * integer arithmetic, so every rule is pinned here with no database: first worked examples, then
 * properties that must hold for any household, checked over many seeded-random ones.
 */

const ANA = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b002';
const CAM = '0192f5a0-0000-7000-8000-00000000c003';
const GONE = '0192f5a0-0000-7000-8000-00000000d004';

const member = (userId: string, joinedAt = '2026-01-01'): BalanceMember => ({ userId, joinedAt });

let counter = 0;
function expense(overrides: Partial<BalanceExpense> & { amountMinor: number }): BalanceExpense {
  counter += 1;
  return {
    id: `0192f5a0-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    date: '2026-10-10',
    kind: 'expense',
    private: false,
    paidBy: null,
    createdBy: ANA,
    ...overrides,
  };
}

const pay = (fromUserId: string, toUserId: string, amountMinor: number): BalancePayment => ({
  fromUserId,
  toUserId,
  amountMinor,
});

function net(input: BalanceInput): Record<string, number> {
  return Object.fromEntries(
    computeBalances(input).map((balance) => [balance.userId, balance.netMinor]),
  );
}

describe('expenseShares', () => {
  it('splits evenly when the amount divides', () => {
    expect(expenseShares('0192f5a0-0000-7000-8000-000000000001', 9000, [ANA, BAO, CAM])).toEqual({
      [ANA]: 3000,
      [BAO]: 3000,
      [CAM]: 3000,
    });
  });

  it('shares sum to the amount to the minor unit, each share a floor or a ceiling', () => {
    const shares = expenseShares('0192f5a0-0000-7000-8000-000000000001', 10001, [ANA, BAO, CAM]);
    const values = Object.values(shares);
    expect(values.reduce((a, b) => a + b, 0)).toBe(10001);
    expect(values.every((value) => value === 3333 || value === 3334)).toBe(true);
  });

  it('hands the odd units out starting from a place the expense id decides', () => {
    // 10000 is 3 x 3333 + 1: one odd unit. Ids ending 0000, 0001 and 0002 start at 0, 1 and 2.
    const one = (suffix: string) =>
      expenseShares(`0192f5a0-0000-7000-8000-00000000${suffix}`, 10000, [ANA, BAO, CAM]);
    expect(one('0000')).toEqual({ [ANA]: 3334, [BAO]: 3333, [CAM]: 3333 });
    expect(one('0001')).toEqual({ [ANA]: 3333, [BAO]: 3334, [CAM]: 3333 });
    expect(one('0002')).toEqual({ [ANA]: 3333, [BAO]: 3333, [CAM]: 3334 });
    // 10001 has two odd units; starting at the last place, the second wraps to the first.
    expect(expenseShares('0192f5a0-0000-7000-8000-000000000002', 10001, [ANA, BAO, CAM])).toEqual({
      [ANA]: 3334,
      [BAO]: 3333,
      [CAM]: 3334,
    });
  });

  it('does not depend on the order participants are given in', () => {
    const id = '0192f5a0-0000-7000-8000-00000000abcd';
    expect(expenseShares(id, 10001, [CAM, ANA, BAO])).toEqual(
      expenseShares(id, 10001, [ANA, BAO, CAM]),
    );
  });

  it('gives one person the whole amount', () => {
    expect(expenseShares('0192f5a0-0000-7000-8000-000000000001', 777, [ANA])).toEqual({
      [ANA]: 777,
    });
  });
});

describe('computeBalances', () => {
  const two = [member(ANA), member(BAO)];

  it('has Bao owe Ana half of what Ana paid', () => {
    const result = net({
      members: two,
      expenses: [expense({ amountMinor: 10000 })],
      payments: [],
    });
    expect(result).toEqual({ [ANA]: 5000, [BAO]: -5000 });
  });

  it('nets expenses each way', () => {
    const result = net({
      members: two,
      expenses: [
        expense({ amountMinor: 10000, createdBy: ANA }),
        expense({ amountMinor: 4000, createdBy: BAO }),
      ],
      payments: [],
    });
    // Ana fronted 100, Bao 40; each owes half of 140 = 70.
    expect(result).toEqual({ [ANA]: 3000, [BAO]: -3000 });
  });

  it('uses paidBy over createdBy', () => {
    const result = net({
      members: two,
      expenses: [expense({ amountMinor: 10000, createdBy: ANA, paidBy: BAO })],
      payments: [],
    });
    expect(result).toEqual({ [ANA]: -5000, [BAO]: 5000 });
  });

  it('lists every current member, even one who owes and is owed nothing', () => {
    const result = computeBalances({
      members: [member(ANA), member(BAO), member(CAM)],
      expenses: [],
      payments: [],
    });
    expect(result.map((balance) => balance.userId).sort()).toEqual([ANA, BAO, CAM].sort());
    expect(result.every((balance) => balance.netMinor === 0)).toBe(true);
  });

  it('leaves out income, private expenses and amounts of zero', () => {
    const result = net({
      members: two,
      expenses: [
        expense({ amountMinor: 10000, kind: 'income' }),
        expense({ amountMinor: 10000, private: true }),
        expense({ amountMinor: 0 }),
      ],
      payments: [],
    });
    expect(result).toEqual({ [ANA]: 0, [BAO]: 0 });
  });

  it('does not charge a member for an expense dated before they joined', () => {
    const result = net({
      members: [member(ANA), member(BAO, '2026-10-05'), member(CAM, '2026-10-20')],
      expenses: [
        // Before Bao and Cam joined: only Ana was there, so nothing is owed.
        expense({ amountMinor: 9000, date: '2026-10-01' }),
        // After Bao joined but before Cam: Ana and Bao split it.
        expense({ amountMinor: 8000, date: '2026-10-10' }),
        // The day Bao joined counts.
        expense({ amountMinor: 2000, date: '2026-10-05' }),
      ],
      payments: [],
    });
    expect(result).toEqual({ [ANA]: 5000, [BAO]: -5000, [CAM]: 0 });
  });

  it('counts the day someone joins as a day they were there', () => {
    const result = net({
      members: [member(ANA), member(BAO, '2026-10-10')],
      expenses: [expense({ amountMinor: 1000, date: '2026-10-10' })],
      payments: [],
    });
    expect(result[BAO]).toBe(-500);
  });

  it('skips an expense whose payer is no longer a member', () => {
    const result = net({
      members: two,
      expenses: [expense({ amountMinor: 10000, createdBy: GONE })],
      payments: [],
    });
    expect(result).toEqual({ [ANA]: 0, [BAO]: 0 });
  });

  it('treats an expense nobody is recorded as having added as the fallback payer’s', () => {
    const rows = [expense({ amountMinor: 10000, createdBy: null })];
    expect(net({ members: two, expenses: rows, payments: [], fallbackPayerId: ANA })).toEqual({
      [ANA]: 5000,
      [BAO]: -5000,
    });
    // With no fallback there is no one to credit, so it is left out.
    expect(net({ members: two, expenses: rows, payments: [] })).toEqual({ [ANA]: 0, [BAO]: 0 });
  });

  it('is zero for one member alone', () => {
    expect(
      net({ members: [member(ANA)], expenses: [expense({ amountMinor: 500 })], payments: [] }),
    ).toEqual({ [ANA]: 0 });
  });

  it('counts a recorded payment as settling', () => {
    const rows = [expense({ amountMinor: 10000 })];
    expect(net({ members: two, expenses: rows, payments: [pay(BAO, ANA, 5000)] })).toEqual({
      [ANA]: 0,
      [BAO]: 0,
    });
    expect(net({ members: two, expenses: rows, payments: [pay(BAO, ANA, 2000)] })).toEqual({
      [ANA]: 3000,
      [BAO]: -3000,
    });
  });

  it('lets a payment overshoot, so the other person owes back', () => {
    const rows = [expense({ amountMinor: 10000 })];
    expect(net({ members: two, expenses: rows, payments: [pay(BAO, ANA, 6000)] })).toEqual({
      [ANA]: -1000,
      [BAO]: 1000,
    });
  });

  it('ignores payments that are not between two different current members, or not positive', () => {
    const rows = [expense({ amountMinor: 10000 })];
    const result = net({
      members: two,
      expenses: rows,
      payments: [
        pay(BAO, GONE, 100),
        pay(GONE, ANA, 100),
        pay(ANA, ANA, 100),
        pay(BAO, ANA, 0),
        pay(BAO, ANA, -5),
      ],
    });
    expect(result).toEqual({ [ANA]: 5000, [BAO]: -5000 });
  });
});

describe('suggestTransfers', () => {
  const nets = (record: Record<string, number>) =>
    Object.entries(record).map(([userId, netMinor]) => ({ userId, netMinor }));

  it('is empty when everyone is settled', () => {
    expect(suggestTransfers(nets({ [ANA]: 0, [BAO]: 0 }))).toEqual([]);
  });

  it('has the one debtor pay the one creditor', () => {
    expect(suggestTransfers(nets({ [ANA]: 5000, [BAO]: -5000 }))).toEqual([
      { fromUserId: BAO, toUserId: ANA, amountMinor: 5000 },
    ]);
  });

  it('matches the largest debtor to the largest creditor first', () => {
    expect(suggestTransfers(nets({ [ANA]: 7000, [BAO]: -3000, [CAM]: -4000 }))).toEqual([
      { fromUserId: CAM, toUserId: ANA, amountMinor: 4000 },
      { fromUserId: BAO, toUserId: ANA, amountMinor: 3000 },
    ]);
  });

  it('splits a debt across creditors when it must', () => {
    expect(suggestTransfers(nets({ [ANA]: 6000, [BAO]: 4000, [CAM]: -10000 }))).toEqual([
      { fromUserId: CAM, toUserId: ANA, amountMinor: 6000 },
      { fromUserId: CAM, toUserId: BAO, amountMinor: 4000 },
    ]);
  });

  it('breaks ties by user id, whatever order it is given', () => {
    const a = suggestTransfers(nets({ [ANA]: 3000, [BAO]: 3000, [CAM]: -6000 }));
    const b = suggestTransfers(nets({ [CAM]: -6000, [BAO]: 3000, [ANA]: 3000 }));
    expect(a).toEqual(b);
    expect(a[0]?.toUserId).toBe(ANA);
  });
});

// --- Properties ----------------------------------------------------------------------------

/** A small seeded generator, so a failing case can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(random: () => number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += Math.floor(random() * 16).toString(16);
  return out;
}

function scenario(seed: number): BalanceInput {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const memberCount = 2 + Math.floor(random() * 4);
  const members: BalanceMember[] = Array.from({ length: memberCount }, () => ({
    userId: `0192f5a0-0000-7000-8000-${hex(random, 12)}`,
    joinedAt: `2026-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}`,
  }));
  const ids = members.map((m) => m.userId);
  const expenses: BalanceExpense[] = Array.from({ length: 5 + Math.floor(random() * 30) }, () => ({
    id: `0192f5a0-0000-7000-8000-${hex(random, 12)}`,
    amountMinor: Math.floor(random() * 500_000),
    date: `2026-${String(1 + Math.floor(random() * 10)).padStart(2, '0')}-${String(1 + Math.floor(random() * 27)).padStart(2, '0')}`,
    kind: random() < 0.1 ? 'income' : 'expense',
    private: random() < 0.15,
    paidBy: random() < 0.4 ? pick(ids) : null,
    createdBy: random() < 0.9 ? pick(ids) : null,
  }));
  const payments: BalancePayment[] = Array.from({ length: Math.floor(random() * 8) }, () => ({
    fromUserId: pick(ids),
    toUserId: pick(ids),
    amountMinor: Math.floor(random() * 100_000),
  }));
  return { members, expenses, payments, fallbackPayerId: pick(ids) };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1);

describe('properties, over many households', () => {
  it.each(SEEDS)('seed %i: the nets sum to zero', (seed) => {
    const total = computeBalances(scenario(seed)).reduce((sum, b) => sum + b.netMinor, 0);
    expect(total).toBe(0);
  });

  it.each(SEEDS)('seed %i: the answer does not depend on the order of the input', (seed) => {
    const input = scenario(seed);
    const reordered: BalanceInput = {
      ...input,
      members: shuffled(input.members, seed + 1),
      expenses: shuffled(input.expenses, seed + 2),
      payments: shuffled(input.payments, seed + 3),
    };
    const sorted = (rows: ReturnType<typeof computeBalances>) =>
      [...rows].sort((a, b) => a.userId.localeCompare(b.userId));
    expect(sorted(computeBalances(reordered))).toEqual(sorted(computeBalances(input)));
  });

  it.each(SEEDS)('seed %i: private expenses, income and zero amounts change nothing', (seed) => {
    const input = scenario(seed);
    const kept = input.expenses.filter(
      (e) => e.kind === 'expense' && !e.private && e.amountMinor > 0,
    );

    expect(computeBalances({ ...input, expenses: kept })).toEqual(computeBalances(input));
  });

  it.each(SEEDS)('seed %i: following the suggested transfers settles everyone', (seed) => {
    const input = scenario(seed);
    const balances = computeBalances(input);
    const transfers = suggestTransfers(balances);

    const settled = computeBalances({
      ...input,
      payments: [
        ...input.payments,
        ...transfers.map((t) => pay(t.fromUserId, t.toUserId, t.amountMinor)),
      ],
    });

    expect(settled.every((b) => b.netMinor === 0)).toBe(true);
    expect(transfers.length).toBeLessThanOrEqual(Math.max(0, input.members.length - 1));
    expect(transfers.every((t) => t.amountMinor > 0 && t.fromUserId !== t.toUserId)).toBe(true);
  });

  it.each(SEEDS)('seed %i: every share is a floor or a ceiling and they sum exactly', (seed) => {
    const random = mulberry32(seed);
    const n = 2 + Math.floor(random() * 6);
    const amount = Math.floor(random() * 10_000_000);
    const people = Array.from({ length: n }, () => `0192f5a0-0000-7000-8000-${hex(random, 12)}`);
    const id = `0192f5a0-0000-7000-8000-${hex(random, 12)}`;

    const shares = Object.values(expenseShares(id, amount, people));

    expect(shares).toHaveLength(n);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
    expect(shares.every((s) => s === Math.floor(amount / n) || s === Math.ceil(amount / n))).toBe(
      true,
    );
  });
});

describe('fairness of the odd unit', () => {
  it('does not always land on the same person', () => {
    const owner = (suffix: number) => {
      const id = `0192f5a0-0000-7000-8000-${suffix.toString(16).padStart(12, '0')}`;
      const shares = expenseShares(id, 10000, [ANA, BAO, CAM]);
      return Object.entries(shares).find(([, value]) => value === 3334)?.[0];
    };
    const seen = new Set(Array.from({ length: 30 }, (_, i) => owner(i)));
    expect(seen.size).toBe(3);
  });
});
