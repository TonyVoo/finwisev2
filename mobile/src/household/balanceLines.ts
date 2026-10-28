import { COPY } from '../copy/strings';
import type { Transfer } from './balances';

/**
 * The lines the Balances section shows: who owes whom, worded for the person looking
 * (`docs/design/12-settle-up.md`). Lines that are about you come first, in the order the transfers
 * were given, then what others owe each other; nothing owed is one reassuring line.
 */

export type BalanceLineKind = 'settled' | 'youOwe' | 'owesYou' | 'owes';

export interface BalanceLine {
  readonly kind: BalanceLineKind;
  readonly key: string;
  readonly text: string;
  /** The other person, on a line about you: who you owe, or who owes you. */
  readonly otherUserId?: string;
  readonly amountMinor?: number;
}

export function balanceLines(input: {
  readonly transfers: readonly Transfer[];
  readonly meId: string | null;
  readonly labelOf: (userId: string) => string;
  readonly format: (amountMinor: number) => string;
}): BalanceLine[] {
  const { transfers, meId, labelOf, format } = input;
  if (transfers.length === 0) {
    return [{ kind: 'settled', key: 'settled', text: COPY.household.balances.settled }];
  }

  const lines = transfers.map((transfer): BalanceLine => {
    const key = `${transfer.fromUserId}>${transfer.toUserId}`;
    const amount = format(transfer.amountMinor);
    if (transfer.fromUserId === meId) {
      return {
        kind: 'youOwe',
        key,
        text: COPY.household.balances.youOwe
          .replace('{name}', labelOf(transfer.toUserId))
          .replace('{amount}', amount),
        otherUserId: transfer.toUserId,
        amountMinor: transfer.amountMinor,
      };
    }
    if (transfer.toUserId === meId) {
      return {
        kind: 'owesYou',
        key,
        text: COPY.household.balances.owesYou
          .replace('{name}', labelOf(transfer.fromUserId))
          .replace('{amount}', amount),
        otherUserId: transfer.fromUserId,
        amountMinor: transfer.amountMinor,
      };
    }
    return {
      kind: 'owes',
      key,
      text: COPY.household.balances.owes
        .replace('{from}', labelOf(transfer.fromUserId))
        .replace('{to}', labelOf(transfer.toUserId))
        .replace('{amount}', amount),
    };
  });

  // Stable: your own lines first, everyone else's after, each in the order given.
  return [
    ...lines.filter((line) => line.kind !== 'owes'),
    ...lines.filter((line) => line.kind === 'owes'),
  ];
}
