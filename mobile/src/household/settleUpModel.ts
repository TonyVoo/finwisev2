import type { Transfer } from './balances';

/**
 * Where the Settle up screen starts (`docs/design/12-settle-up.md`): with what you actually owe,
 * or are owed, because that is nearly always what is being settled. Every part stays editable.
 */

export interface Suggestion {
  /** True when you are the one paying. */
  readonly iPaid: boolean;
  readonly amountMinor: number;
}

/** What settles things between you and one person, from the suggested transfers; null if none. */
export function suggestionWith(
  transfers: readonly Transfer[],
  meId: string,
  personId: string,
): Suggestion | null {
  for (const transfer of transfers) {
    if (transfer.fromUserId === meId && transfer.toUserId === personId) {
      return { iPaid: true, amountMinor: transfer.amountMinor };
    }
    if (transfer.toUserId === meId && transfer.fromUserId === personId) {
      return { iPaid: false, amountMinor: transfer.amountMinor };
    }
  }
  return null;
}

export interface StartingPoint extends Suggestion {
  readonly personId: string;
}

/**
 * The first suggested transfer that involves you, as a person, a direction and an amount; or, when
 * nothing is owed, the first other member with an empty amount. Null when there is nobody else.
 */
export function startingPoint(
  transfers: readonly Transfer[],
  meId: string,
  otherIds: readonly string[],
): StartingPoint | null {
  for (const transfer of transfers) {
    if (transfer.fromUserId === meId) {
      return { personId: transfer.toUserId, iPaid: true, amountMinor: transfer.amountMinor };
    }
    if (transfer.toUserId === meId) {
      return { personId: transfer.fromUserId, iPaid: false, amountMinor: transfer.amountMinor };
    }
  }
  const first = otherIds[0];
  return first === undefined ? null : { personId: first, iPaid: true, amountMinor: 0 };
}
