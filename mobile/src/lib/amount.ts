import { LIMITS } from '@expense-tracker/shared';

/**
 * The amount the keypad edits, held as an integer.
 *
 * > **The amount is an integer number of minor units. There is no string, and there is no
 * > `parseFloat`, at any point.** (`docs/design/06-expense-form.md` §Behaviour rule 2.)
 *
 * The keypad mutates that integer directly, so `12.50` on screen is the integer `1250`
 * formatted for display and never a text value parsed back. This is what lets the spec
 * promise there is no such thing as a malformed amount: `0.1.2`, `--5`, `1e9`, `١٢` and the
 * empty string are not inputs that get validated, they are inputs that cannot be
 * constructed. The display is a `Text`, not a `TextInput`, which is the other half of the
 * same guarantee.
 *
 * Everything here is pure. It is the piece of the form worth testing exhaustively, and it
 * has no React, no database and no `Intl` in it.
 */

/**
 * Keypad state.
 *
 * `decimalPressed` exists only to bound how many more digits are accepted. The shifting
 * model below already places the decimal point, so the decimal key is "a convenience that
 * is almost always a no-op" (§Behaviour rule 3) — it does not move the point, it caps the
 * minor part.
 */
export interface AmountInput {
  /** The value, in minor units. Always a non-negative safe integer. */
  readonly amountMinor: number;
  /** True once the decimal key has been pressed and not yet backspaced away. */
  readonly decimalPressed: boolean;
  /** Digits entered since the decimal key was pressed. Meaningless while it is false. */
  readonly minorDigits: number;
}

/** What a key press did. `rejected` drives the shake and the over-maximum snackbar. */
export interface AmountKeyResult {
  readonly input: AmountInput;
  /**
   * True when the press changed nothing because the value would have exceeded
   * {@link LIMITS.AMOUNT_MINOR_MAX} or the currency's decimal count. Input is **capped,
   * not rejected**: the user never ends up with a value they must manually trim back
   * (§Behaviour rule 5).
   */
  readonly rejected: boolean;
}

export const EMPTY_AMOUNT: AmountInput = {
  amountMinor: 0,
  decimalPressed: false,
  minorDigits: 0,
};

/**
 * Start from an existing amount, as edit mode does.
 *
 * `decimalPressed` starts false even though a prefilled `1250` plainly has minor digits:
 * the flag is about what the *user* has pressed in this session, and starting it true
 * would make the next digit press a no-op on an amount they had not yet touched.
 */
export function amountInputFrom(amountMinor: number): AmountInput {
  return { amountMinor, decimalPressed: false, minorDigits: 0 };
}

/**
 * Append a digit: `next = value * 10 + d`.
 *
 * Digits shift in from the right like a cash register. There is no cursor, no selection
 * and no insertion point — digits only ever arrive at the right-hand end and only ever
 * leave from it.
 *
 * @param decimals the currency's minor-unit count, from `currencyDecimals`.
 */
export function pressDigit(input: AmountInput, digit: number, decimals: number): AmountKeyResult {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new RangeError(`${digit} is not a keypad digit`);
  }

  // With the decimal key pressed, the minor part is full once it holds `decimals` digits.
  // On a zero-decimal currency the key does not exist, so this cannot fire for `JPY`.
  if (input.decimalPressed && input.minorDigits >= decimals) {
    return { input, rejected: true };
  }

  const next = input.amountMinor * 10 + digit;
  // "A digit is accepted only while `value * 10 + d <= AMOUNT_MINOR_MAX`" (§5).
  if (next > LIMITS.AMOUNT_MINOR_MAX) {
    return { input, rejected: true };
  }

  return {
    input: {
      amountMinor: next,
      decimalPressed: input.decimalPressed,
      minorDigits: input.decimalPressed ? input.minorDigits + 1 : 0,
    },
    rejected: false,
  };
}

/**
 * Press the decimal key: "the next digits are the minor part".
 *
 * Pressing it when the flag is already set does nothing, which is how **two decimal points
 * cannot be entered** — not by validating a second one, but by there being nothing for it
 * to do (§Behaviour rule 3).
 */
export function pressDecimal(input: AmountInput): AmountKeyResult {
  if (input.decimalPressed) {
    return { input, rejected: false };
  }
  return {
    input: { amountMinor: input.amountMinor, decimalPressed: true, minorDigits: 0 },
    rejected: false,
  };
}

/**
 * Remove the rightmost digit: `next = floor(value / 10)`.
 *
 * Backspace clears the decimal flag when the value returns to having no minor digits, so a
 * user who overshoots and comes back can press `.` again.
 */
export function pressBackspace(input: AmountInput): AmountKeyResult {
  const next = Math.floor(input.amountMinor / 10);

  if (!input.decimalPressed) {
    return { input: { ...input, amountMinor: next }, rejected: false };
  }

  if (input.minorDigits > 0) {
    return {
      input: { amountMinor: next, decimalPressed: true, minorDigits: input.minorDigits - 1 },
      rejected: false,
    };
  }

  return { input: { amountMinor: next, decimalPressed: false, minorDigits: 0 }, rejected: false };
}

/**
 * Whether this amount may be saved.
 *
 * **Zero is not a valid expense.** The contract permits `amountMinor: 0` (`AmountMinor` is
 * `.min(0)`) but a zero-value expense carries no information and is far more likely to be
 * an accidental save than an intention. The client requires `> 0` and the server stays
 * permissive, which is the correct asymmetry (§Behaviour rule 6).
 */
export function isSavableAmount(amountMinor: number): boolean {
  return Number.isInteger(amountMinor) && amountMinor > 0 && amountMinor <= LIMITS.AMOUNT_MINOR_MAX;
}

/**
 * True for an amount that is outside what this client can save but is already stored —
 * the one genuine amount *error* state, and it originates from data rather than from
 * typing (§Behaviour rule 8, last row). Such a row is rendered as-is and never
 * auto-corrected.
 */
export function isOutOfRangeAmount(amountMinor: number): boolean {
  return !Number.isInteger(amountMinor) || amountMinor < 0 || amountMinor > LIMITS.AMOUNT_MINOR_MAX;
}
