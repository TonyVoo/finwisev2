import { useMemo } from 'react';
import { useBalanceExpenses, useSettlements, useUserEmail } from '../db/hooks';
import { formatMoney } from '../lib/money';
import { labelOfMember, type MemberRef } from './addedBy';
import { balanceLines, type BalanceLine } from './balanceLines';
import { computeBalances, suggestTransfers, type Balance, type Transfer } from './balances';

/** Before the first member joined: a member whose join date is not known counts from the start. */
const FROM_THE_BEGINNING = '0000-01-01';

export interface BalanceState {
  /** False until the rows it reads have been read. */
  readonly ready: boolean;
  /** The person holding the phone, among `members`; null when they are not in the list. */
  readonly meId: string | null;
  readonly balances: readonly Balance[];
  /** One way to settle everything, as {@link suggestTransfers} gives it. */
  readonly transfers: readonly Transfer[];
  readonly lines: readonly BalanceLine[];
  /** True while anyone owes anyone anything. */
  readonly unsettled: boolean;
  /** What to call a member, `You` for the person looking and a former member for anyone gone. */
  readonly labelOf: (userId: string) => string;
}

/**
 * Who owes whom, from the rows this phone holds (`docs/design/12-settle-up.md`).
 *
 * `members` is whoever the caller considers the household's current members: the Household screen
 * passes what it is showing, which comes with each member's `joinedAt`. The amounts are in the
 * household's `currency`.
 */
export function useBalances(
  members: readonly MemberRef[] | undefined,
  currency: string,
): BalanceState {
  const expenses = useBalanceExpenses().data;
  const payments = useSettlements().data;
  const myEmail = useUserEmail().data;

  return useMemo(() => {
    const list = members ?? [];
    const meId = list.find((member) => member.email === myEmail)?.userId ?? null;
    const labelOf = (userId: string): string => labelOfMember(list, meId, userId);
    const ready = members !== undefined && expenses !== undefined && payments !== undefined;
    const balances = ready
      ? computeBalances({
          members: list.map((member) => ({
            userId: member.userId,
            joinedAt: member.joinedAt ?? FROM_THE_BEGINNING,
          })),
          expenses: expenses ?? [],
          payments: payments ?? [],
          fallbackPayerId: meId,
        })
      : [];
    const transfers = suggestTransfers(balances);
    return {
      ready,
      meId,
      balances,
      transfers,
      lines: balanceLines({
        transfers,
        meId,
        labelOf,
        format: (amountMinor) => formatMoney(amountMinor, currency),
      }),
      unsettled: transfers.length > 0,
      labelOf,
    };
  }, [members, expenses, payments, myEmail, currency]);
}
