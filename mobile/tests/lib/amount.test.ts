import { LIMITS } from '@expense-tracker/shared';
import {
  EMPTY_AMOUNT,
  amountInputFrom,
  isOutOfRangeAmount,
  isSavableAmount,
  pressBackspace,
  pressDecimal,
  pressDigit,
  type AmountInput,
} from '@/lib/amount';
import { formatMoney } from '@/lib/money';

/**
 * Covers `src/lib/amount.ts` - the keypad's integer model.
 *
 * This is the piece of the form worth testing exhaustively, because it is where the
 * promise in `docs/design/06-expense-form.md` rule 2 either holds or does not: **the
 * amount is an integer number of minor units, and there is no `parseFloat` anywhere on
 * the path from the keypad to SQLite.** Every case here is integer arithmetic; the only
 * `formatMoney` calls are the ones reproducing the spec's own keystroke table, which is
 * written in rendered strings.
 */

const USD = 2;
const JPY = 0;

/** Press a run of keys, so a case reads like the spec's table. `.` is the decimal key. */
function press(keys: string, decimals: number, from: AmountInput = EMPTY_AMOUNT): AmountInput {
  let input = from;
  for (const key of keys) {
    input = key === '.' ? pressDecimal(input).input : pressDigit(input, Number(key), decimals).input;
  }
  return input;
}

describe('digits shift in from the right', () => {
  /** `06-expense-form.md` rule 2, the keystroke table verbatim. */
  it.each([
    ['', 0, '$0.00'],
    ['1', 1, '$0.01'],
    ['12', 12, '$0.12'],
    ['125', 125, '$1.25'],
    ['1250', 1250, '$12.50'],
  ])('%s gives %i minor units', (keys, amountMinor, rendered) => {
    const input = press(keys, USD);
    expect(input.amountMinor).toBe(amountMinor);
    expect(formatMoney(input.amountMinor, 'USD', 'en-US')).toBe(rendered);
  });

  it('backspaces back down the same ladder', () => {
    let input = press('1250', USD);
    input = pressBackspace(input).input;
    expect(input.amountMinor).toBe(125);
    input = pressBackspace(pressBackspace(pressBackspace(input).input).input).input;
    expect(input.amountMinor).toBe(0);
  });

  it('backspaces an empty amount to zero rather than below it', () => {
    expect(pressBackspace(EMPTY_AMOUNT).input.amountMinor).toBe(0);
    expect(pressBackspace(pressBackspace(EMPTY_AMOUNT).input).input.amountMinor).toBe(0);
  });

  it('keeps a leading zero from creating a value', () => {
    expect(press('0', USD).amountMinor).toBe(0);
    expect(press('000', USD).amountMinor).toBe(0);
    expect(press('0005', USD).amountMinor).toBe(5);
  });

  it('rejects a key that is not a digit, because no such key exists', () => {
    expect(() => pressDigit(EMPTY_AMOUNT, 10, USD)).toThrow(RangeError);
    expect(() => pressDigit(EMPTY_AMOUNT, -1, USD)).toThrow(RangeError);
    expect(() => pressDigit(EMPTY_AMOUNT, 1.5, USD)).toThrow(RangeError);
  });

  it('never mutates the input it was given', () => {
    const start = press('125', USD);
    const snapshot = { ...start };
    pressDigit(start, 0, USD);
    pressBackspace(start);
    pressDecimal(start);
    expect(start).toEqual(snapshot);
  });
});

describe('the decimal key', () => {
  /**
   * Rule 3: it is "a convenience that is almost always a no-op". `12` then `.` then `50`
   * and `1250` straight through reach the same integer, because the shifting model has
   * already placed the point.
   */
  it('reaches the same value as typing the digits straight through', () => {
    expect(press('12.50', USD).amountMinor).toBe(1250);
    expect(press('1250', USD).amountMinor).toBe(1250);
  });

  it('caps the minor part at the currency decimal count', () => {
    const twoMinorDigits = press('12.50', USD);
    const third = pressDigit(twoMinorDigits, 9, USD);

    expect(third.rejected).toBe(true);
    expect(third.input.amountMinor).toBe(1250);
    expect(press('12.5099999', USD).amountMinor).toBe(1250);
  });

  // Rule 3: "two decimal points cannot be entered" - not by validating a second one, but
  // by there being nothing for it to do.
  it('does nothing when pressed twice, and reports no rejection', () => {
    const once = pressDecimal(press('12', USD));
    const twice = pressDecimal(once.input);

    expect(twice.input).toEqual(once.input);
    expect(twice.rejected).toBe(false);
  });

  it('clears the flag on backspace, so the key can be pressed again', () => {
    const afterOneMinorDigit = press('12.5', USD);
    expect(afterOneMinorDigit.decimalPressed).toBe(true);
    expect(afterOneMinorDigit.minorDigits).toBe(1);

    const back = pressBackspace(afterOneMinorDigit).input;
    expect(back).toMatchObject({ amountMinor: 12, decimalPressed: true, minorDigits: 0 });

    const backAgain = pressBackspace(back).input;
    expect(backAgain).toMatchObject({ amountMinor: 1, decimalPressed: false, minorDigits: 0 });
    expect(press('5', USD, backAgain).amountMinor).toBe(15);
  });

  /**
   * `EXP-12`. On a zero-decimal currency the key is hidden rather than disabled, so this
   * state is unreachable from the UI - but the model still has to be coherent if it is
   * reached, and it is: with `decimals === 0` the minor part is full the moment the flag
   * is set, so no digit after it is accepted.
   */
  it('accepts no further digit on a zero-decimal currency', () => {
    const afterDecimal = pressDecimal(press('125', JPY));
    const digit = pressDigit(afterDecimal.input, 9, JPY);

    expect(digit.rejected).toBe(true);
    expect(digit.input.amountMinor).toBe(125);
    expect(formatMoney(125, 'JPY', 'en-US')).toBe('¥125');
  });
});

describe('the maximum', () => {
  const max = LIMITS.AMOUNT_MINOR_MAX;

  it('accepts the maximum exactly', () => {
    const input = press(String(max), USD);
    expect(input.amountMinor).toBe(max);
    expect(isSavableAmount(input.amountMinor)).toBe(true);
  });

  /**
   * Rule 5: "input is capped, not rejected". The press is ignored and the displayed value
   * is unchanged - the user never ends up with a value they must manually trim back.
   */
  it('ignores the digit that would exceed it, and says it rejected one', () => {
    const atMax = press(String(max), USD);
    const over = pressDigit(atMax, 9, USD);

    expect(over.rejected).toBe(true);
    expect(over.input.amountMinor).toBe(max);
  });

  it('ignores every further digit, not just the first', () => {
    const hammered = press(`${max}99999`, USD);
    expect(hammered.amountMinor).toBe(max);
  });

  // The cap is `value * 10 + d <= AMOUNT_MINOR_MAX`, so the last accepted press depends on
  // the digit: at 99,999,999,999 a `9` fits and nothing larger does.
  it('accepts a digit only while the shifted value still fits', () => {
    const oneShort = press('99999999999', USD);
    expect(oneShort.amountMinor).toBe(99_999_999_999);
    expect(pressDigit(oneShort, 9, USD).input.amountMinor).toBe(max);
    expect(pressDigit(oneShort, 9, USD).rejected).toBe(false);
  });

  it('stays inside the safe integer range, so no press is lossy', () => {
    const atMax = press(String(max), USD);
    expect(Number.isSafeInteger(atMax.amountMinor)).toBe(true);
    expect(atMax.amountMinor * 10 + 9).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('what may be saved', () => {
  // Rule 6: zero is not a valid expense. The contract permits `amountMinor: 0`; the client
  // requires `> 0` and the server stays permissive, which is the correct asymmetry.
  it('refuses zero and accepts one minor unit', () => {
    expect(isSavableAmount(0)).toBe(false);
    expect(isSavableAmount(1)).toBe(true);
  });

  it('refuses anything that is not a whole number of minor units', () => {
    expect(isSavableAmount(12.5)).toBe(false);
    expect(isSavableAmount(Number.NaN)).toBe(false);
    expect(isSavableAmount(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('refuses a negative and an over-maximum value', () => {
    expect(isSavableAmount(-1)).toBe(false);
    expect(isSavableAmount(LIMITS.AMOUNT_MINOR_MAX + 1)).toBe(false);
  });

  /**
   * Rule 8, last row: the one genuine amount *error* state, and it arrives from data
   * rather than from typing. Such a row is rendered as-is and never auto-corrected.
   */
  it('flags a stored amount outside what this client can save', () => {
    expect(isOutOfRangeAmount(LIMITS.AMOUNT_MINOR_MAX + 1)).toBe(true);
    expect(isOutOfRangeAmount(-500)).toBe(true);
    expect(isOutOfRangeAmount(12.5)).toBe(true);
    expect(isOutOfRangeAmount(0)).toBe(false);
    expect(isOutOfRangeAmount(1250)).toBe(false);
  });
});

describe('editing an existing amount', () => {
  it('starts from the stored integer with the decimal key unpressed', () => {
    const input = amountInputFrom(1250);
    expect(input).toEqual({ amountMinor: 1250, decimalPressed: false, minorDigits: 0 });
  });

  /**
   * The flag starts false even though a prefilled `1250` plainly has minor digits: it is
   * about what the *user* has pressed this session. Starting it true would make the next
   * digit press a no-op on an amount they had not yet touched.
   */
  it('accepts a digit on a prefilled amount, shifting it as usual', () => {
    expect(press('9', USD, amountInputFrom(1250)).amountMinor).toBe(12_509);
  });

  it('is immediately savable when the stored amount is savable', () => {
    expect(isSavableAmount(amountInputFrom(1250).amountMinor)).toBe(true);
    expect(isSavableAmount(amountInputFrom(0).amountMinor)).toBe(false);
  });
});
