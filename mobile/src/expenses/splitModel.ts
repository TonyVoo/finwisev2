import { parseBudgetInput } from '../categories/budgetInput';

/**
 * Dividing one amount between categories (`docs/design/29-split-expense.md`). The person types an amount per part; one
 * part may be left empty to take what is left. Everything is integers, in the account currency's minor units.
 */

export interface SplitDraft {
  readonly categoryId: string | null;
  readonly amountText: string;
}

export interface SplitPart {
  readonly categoryId: string;
  readonly amountMinor: number;
}

export type SplitResult =
  | { readonly status: 'ok'; readonly parts: readonly SplitPart[]; readonly remainingMinor: 0 }
  | {
      readonly status: 'invalid';
      readonly reason: 'parts' | 'category' | 'duplicate' | 'amount' | 'sum';
      /** Total minus what has been typed so far; negative when over. For the "left to assign" line. */
      readonly remainingMinor: number;
    };

export function resolveSplit(
  totalMinor: number,
  drafts: readonly SplitDraft[],
  decimals: number,
): SplitResult {
  const typed = drafts.map((draft) => parseBudgetInput(draft.amountText, decimals));
  const typedSum = typed.reduce((sum, t) => sum + (t.kind === 'amount' ? t.amountMinor : 0), 0);
  const remainingMinor = totalMinor - typedSum;
  const invalid = (reason: 'parts' | 'category' | 'duplicate' | 'amount' | 'sum'): SplitResult => ({
    status: 'invalid',
    reason,
    remainingMinor,
  });

  if (drafts.length < 2) return invalid('parts');
  if (drafts.some((d) => d.categoryId === null)) return invalid('category');
  const ids = drafts.map((d) => d.categoryId);
  if (new Set(ids).size !== ids.length) return invalid('duplicate');

  const empty = typed.filter((t) => t.kind === 'none').length;
  if (typed.some((t) => t.kind === 'invalid') || empty > 1) return invalid('amount');

  if (empty === 1) {
    // The empty part takes the rest, which must be something.
    if (remainingMinor <= 0) return invalid('amount');
  } else if (remainingMinor !== 0) {
    return invalid('sum');
  }

  const parts = drafts.map((draft, i): SplitPart => {
    const t = typed[i];
    return {
      categoryId: draft.categoryId as string,
      amountMinor: t !== undefined && t.kind === 'amount' ? t.amountMinor : remainingMinor,
    };
  });
  return { status: 'ok', parts, remainingMinor: 0 };
}
