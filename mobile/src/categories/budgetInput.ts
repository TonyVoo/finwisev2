import { LIMITS } from '@expense-tracker/shared';

/**
 * The budget field's text, turned into what the contract stores.
 *
 * Typed text rather than the expense form's keypad: a budget is set once and rarely, and a
 * category sheet is already a keyboard screen. The price is that the text can be malformed,
 * so this is the one place it is judged - integer arithmetic on the digits, never a float,
 * for the same reason amounts are stored as minor units at all.
 *
 * - empty            -> `{ kind: 'none' }`   (clears the budget)
 * - a valid amount   -> `{ kind: 'amount' }`
 * - anything else    -> `{ kind: 'invalid', reason }`
 *
 * Both `.` and `,` are accepted as the decimal mark, because the device's keyboard decides
 * which one the person can type, not the app. Grouping separators are not accepted: with
 * both marks allowed, `1,234` cannot be told from `1.234` and guessing would store the
 * wrong money.
 */
export type BudgetInput =
  | { readonly kind: 'none' }
  | { readonly kind: 'amount'; readonly amountMinor: number }
  | { readonly kind: 'invalid'; readonly reason: 'format' | 'zero' | 'max' };

export function parseBudgetInput(text: string, decimals: number): BudgetInput {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'none' };

  const match = /^(\d+)(?:[.,](\d*))?$/.exec(trimmed);
  if (match === null) return { kind: 'invalid', reason: 'format' };

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) return { kind: 'invalid', reason: 'format' };

  // Digits only from here, so the string-to-number conversion is exact up to 2^53; the
  // length guard stops a pasted 40-digit number from becoming Infinity first.
  const digits = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  if (digits.length > String(LIMITS.AMOUNT_MINOR_MAX).length) {
    return { kind: 'invalid', reason: 'max' };
  }
  const amountMinor = Number(digits);
  if (amountMinor === 0) return { kind: 'invalid', reason: 'zero' };
  if (amountMinor > LIMITS.AMOUNT_MINOR_MAX) return { kind: 'invalid', reason: 'max' };
  return { kind: 'amount', amountMinor };
}

/** The stored amount as editable text: `4000` -> `40.00`, so an edit round-trips exactly. */
export function budgetInputText(amountMinor: number | null, decimals: number): string {
  if (amountMinor === null) return '';
  if (decimals === 0) return String(amountMinor);
  const digits = String(amountMinor).padStart(decimals + 1, '0');
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
