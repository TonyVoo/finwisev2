/**
 * The overall monthly limit (`docs/design/27-monthly-limit.md`): what is left of it, spread over the days left.
 * Integers throughout; the per-day figure rounds down, so spending it every day never goes over.
 */
export type SafeToSpend =
  | {
      readonly kind: 'left';
      readonly perDayMinor: number;
      readonly remainingMinor: number;
      /** Including today. */
      readonly daysLeft: number;
    }
  | { readonly kind: 'over'; readonly overMinor: number };

export function safeToSpend(input: {
  readonly limitMinor: number;
  readonly spentMinor: number;
  readonly dayOfMonth: number;
  readonly daysInMonth: number;
}): SafeToSpend {
  const remainingMinor = input.limitMinor - input.spentMinor;
  if (remainingMinor < 0) return { kind: 'over', overMinor: -remainingMinor };
  const daysLeft = Math.max(1, input.daysInMonth - input.dayOfMonth + 1);
  return {
    kind: 'left',
    perDayMinor: Math.floor(remainingMinor / daysLeft),
    remainingMinor,
    daysLeft,
  };
}
