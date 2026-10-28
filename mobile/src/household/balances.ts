/**
 * Who owes whom in a household, from the rows a phone already holds
 * (`docs/design/12-settle-up.md`).
 *
 * Pure and exact: integers in, integers out, no clock, no storage, no network. Two phones with the
 * same synced rows always show the same balances, which is why nothing here is asked of the server
 * and why the arithmetic never touches a float.
 *
 * The rules, in one place:
 *
 * - An expense is split equally among the **current members who had joined by its date**. Income,
 *   private expenses and amounts of zero are not split. Fewer than two participants means nothing
 *   is owed on it.
 * - It is paid by `paidBy`, else `createdBy`, else the `fallbackPayerId` (a just-made expense the
 *   server has not stamped yet). A payer who is not a current member leaves the expense out
 *   entirely, rather than charging the others for money a stranger spent.
 * - A recorded payment moves the balance by exactly its amount, and only between two different
 *   current members.
 * - Positive `netMinor` means the household owes that member; negative means they owe it. Over
 *   current members the nets always sum to zero.
 */

export interface BalanceMember {
  readonly userId: string;
  /** The day they joined, `YYYY-MM-DD` (a full timestamp is read as its date). */
  readonly joinedAt: string;
}

export interface BalanceExpense {
  readonly id: string;
  readonly amountMinor: number;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: 'expense' | 'income';
  readonly private: boolean;
  readonly paidBy: string | null;
  readonly createdBy: string | null;
}

export interface BalancePayment {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amountMinor: number;
}

export interface BalanceInput {
  /** The household's current members. Anyone else is outside the arithmetic. */
  readonly members: readonly BalanceMember[];
  /** Live rows only: the caller does not pass deleted ones. */
  readonly expenses: readonly BalanceExpense[];
  readonly payments: readonly BalancePayment[];
  /** Who paid an expense that records no payer or author yet; usually the person holding the phone. */
  readonly fallbackPayerId?: string | null;
}

export interface Balance {
  readonly userId: string;
  readonly netMinor: number;
}

export interface Transfer {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly amountMinor: number;
}

function byUserId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The place the odd units start from: the last four hex digits of the id, as a number. */
function rotation(expenseId: string): number {
  const digits = expenseId.replace(/[^0-9a-f]/gi, '').slice(-4);
  const parsed = Number.parseInt(digits, 16);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Split `amountMinor` equally. Everyone gets the floor; the remainder goes one unit at a time
 * starting from a place the expense id decides, so shares sum to the amount exactly and the odd
 * unit does not always land on the same person. Independent of the order participants are given.
 */
export function expenseShares(
  expenseId: string,
  amountMinor: number,
  participants: readonly string[],
): Record<string, number> {
  const people = [...participants].sort(byUserId);
  const count = people.length;
  const base = Math.floor(amountMinor / count);
  const remainder = amountMinor - base * count;
  const start = rotation(expenseId) % count;
  const shares: Record<string, number> = {};
  people.forEach((userId, index) => {
    const offset = (index - start + count) % count;
    shares[userId] = base + (offset < remainder ? 1 : 0);
  });
  return shares;
}

/** Every current member's net position, by user id. */
export function computeBalances(input: BalanceInput): Balance[] {
  const nets = new Map<string, number>(input.members.map((member) => [member.userId, 0]));
  const joined = input.members.map((member) => ({
    userId: member.userId,
    day: member.joinedAt.slice(0, 10),
  }));

  for (const expense of input.expenses) {
    if (expense.kind !== 'expense' || expense.private || expense.amountMinor <= 0) continue;
    const payer = expense.paidBy ?? expense.createdBy ?? input.fallbackPayerId ?? null;
    if (payer === null || !nets.has(payer)) continue;
    const participants = joined
      .filter((member) => member.day <= expense.date)
      .map((member) => member.userId);
    if (participants.length < 2) continue;

    nets.set(payer, (nets.get(payer) ?? 0) + expense.amountMinor);
    const shares = expenseShares(expense.id, expense.amountMinor, participants);
    for (const [userId, share] of Object.entries(shares)) {
      nets.set(userId, (nets.get(userId) ?? 0) - share);
    }
  }

  for (const payment of input.payments) {
    if (
      payment.amountMinor <= 0 ||
      payment.fromUserId === payment.toUserId ||
      !nets.has(payment.fromUserId) ||
      !nets.has(payment.toUserId)
    ) {
      continue;
    }
    nets.set(payment.fromUserId, (nets.get(payment.fromUserId) ?? 0) + payment.amountMinor);
    nets.set(payment.toUserId, (nets.get(payment.toUserId) ?? 0) - payment.amountMinor);
  }

  return [...nets.entries()]
    .sort(([a], [b]) => byUserId(a, b))
    .map(([userId, netMinor]) => ({ userId, netMinor }));
}

/**
 * A way to settle everything: the largest debtor pays the largest creditor, repeat. At most one
 * fewer transfer than there are people, and for two people the one obvious line. Ties break by
 * user id, so every phone suggests the same thing. A suggestion only; nobody is obliged to follow it.
 */
export function suggestTransfers(balances: readonly Balance[]): Transfer[] {
  const largestFirst = (a: { userId: string; left: number }, b: { userId: string; left: number }) =>
    b.left - a.left || byUserId(a.userId, b.userId);
  const debtors = balances
    .filter((balance) => balance.netMinor < 0)
    .map((balance) => ({ userId: balance.userId, left: -balance.netMinor }));
  const creditors = balances
    .filter((balance) => balance.netMinor > 0)
    .map((balance) => ({ userId: balance.userId, left: balance.netMinor }));

  const transfers: Transfer[] = [];
  for (;;) {
    debtors.sort(largestFirst);
    creditors.sort(largestFirst);
    const debtor = debtors[0];
    const creditor = creditors[0];
    if (debtor === undefined || creditor === undefined) break;
    const amountMinor = Math.min(debtor.left, creditor.left);
    transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountMinor });
    debtor.left -= amountMinor;
    creditor.left -= amountMinor;
    if (debtor.left === 0) debtors.shift();
    if (creditor.left === 0) creditors.shift();
  }
  return transfers;
}
