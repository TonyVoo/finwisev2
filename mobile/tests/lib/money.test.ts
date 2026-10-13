import { LIMITS } from '@expense-tracker/shared';
import { currencyDecimals, formatAmountOnly, formatMoney } from '@/lib/money';

/**
 * Covers `src/lib/money.ts` - the only place an integer number of minor units becomes a
 * string, and a one-way street: there is no `parseMoney`, so a formatted amount is never
 * parsed back (`06-expense-form.md` rule 2).
 *
 * The split between what is and is not asserted literally follows
 * `tests/lib/currencyFormatting.test.ts`: the **fraction-digit count** is a property of
 * the currency and needs no locale, while a **rendered string** is a property of the
 * locale, so every literal below fixes one. Under Node's full ICU, as that file notes;
 * the device is Hermes over the platform's own formatters, which no jest suite can see.
 */

describe('how many minor digits a currency has', () => {
  it('reads the count off the currency, not off a hardcoded 2', () => {
    expect(currencyDecimals('USD', 'en-US')).toBe(2);
    expect(currencyDecimals('EUR', 'en-US')).toBe(2);
    expect(currencyDecimals('JPY', 'en-US')).toBe(0);
    expect(currencyDecimals('KRW', 'en-US')).toBe(0);
    expect(currencyDecimals('BHD', 'en-US')).toBe(3);
  });

  it('answers the same count whatever locale is rendering it', () => {
    for (const locale of ['en-US', 'de-DE', 'ja-JP', 'ar-EG']) {
      expect(currencyDecimals('JPY', locale)).toBe(0);
      expect(currencyDecimals('USD', locale)).toBe(2);
    }
  });
});

describe('formatting minor units', () => {
  it('renders the common cases', () => {
    expect(formatMoney(1250, 'USD', 'en-US')).toBe('$12.50');
    expect(formatMoney(128_450, 'USD', 'en-US')).toBe('$1,284.50');
    expect(formatMoney(1, 'USD', 'en-US')).toBe('$0.01');
  });

  /**
   * `04-expense-list.md` rule 5: the zero total renders as `$0.00`, not as a dash or a
   * blank. A whole amount keeps its minor digits for the same reason - a column of
   * amounts that alternates between `$12` and `$12.50` does not align.
   */
  it('pins the minor digits on a whole amount and on zero', () => {
    expect(formatMoney(0, 'USD', 'en-US')).toBe('$0.00');
    expect(formatMoney(1200, 'USD', 'en-US')).toBe('$12.00');
  });

  it('renders a zero-decimal currency without a decimal part', () => {
    expect(formatMoney(125, 'JPY', 'en-US')).toBe('¥125');
    expect(formatMoney(0, 'JPY', 'en-US')).toBe('¥0');
    expect(formatMoney(100_000, 'JPY', 'en-US')).toBe('¥100,000');
  });

  /**
   * The separator ICU puts between the code and the number is U+00A0, not a space, so the
   * assertion is on the digits rather than on a literal whose difference from the obvious
   * one is invisible in a diff.
   */
  it('renders a three-decimal currency with three', () => {
    const rendered = formatMoney(1250, 'BHD', 'en-US');
    expect(rendered).toMatch(/\bBHD\b/);
    expect(rendered.replace(/[^0-9.]/g, '')).toBe('1.250');
  });

  /**
   * The symbol, its position and the separators are the locale's business. Asserted as
   * agreement on the *digits* rather than on one string, because fixing a literal per
   * locale would be asserting ICU's data rather than this module.
   */
  it('lets the locale place the symbol and the separators', () => {
    const de = formatMoney(128_450, 'EUR', 'de-DE');
    const us = formatMoney(128_450, 'EUR', 'en-US');

    expect(de).not.toBe(us);
    expect(de.replace(/[^0-9]/g, '')).toBe('128450');
    expect(us.replace(/[^0-9]/g, '')).toBe('128450');
  });

  /**
   * The reason the whole app stores integers. `0.1 + 0.2 !== 0.3`, and a month of those
   * is a wrong total - so the sum happens in minor units and the division to major units
   * happens once, at the last possible moment, on a value small enough to be exact.
   */
  it('is exact where float arithmetic is not', () => {
    expect(formatMoney(10 + 20, 'USD', 'en-US')).toBe('$0.30');
    expect(formatMoney(3 * 1105, 'USD', 'en-US')).toBe('$33.15');
    expect(formatMoney(70, 'USD', 'en-US')).toBe('$0.70');
    expect(formatMoney(8_070, 'USD', 'en-US')).toBe('$80.70');
  });

  it('renders every cent value of a dollar exactly', () => {
    for (let cents = 0; cents < 100; cents += 1) {
      expect(formatMoney(cents, 'USD', 'en-US')).toBe(`$0.${cents.toString().padStart(2, '0')}`);
    }
  });

  it('renders the largest amount the contract allows', () => {
    expect(formatMoney(LIMITS.AMOUNT_MINOR_MAX, 'USD', 'en-US')).toBe('$9,999,999,999.99');
  });

  /**
   * `06-expense-form.md` rule 8, last row: a row with an out-of-range amount can arrive
   * from a buggy or hostile peer by sync. It is rendered as-is - never crashing, never
   * auto-corrected - and the form is what shows the error state.
   */
  it('renders an out-of-range stored amount rather than throwing', () => {
    expect(() => formatMoney(LIMITS.AMOUNT_MINOR_MAX * 100, 'USD', 'en-US')).not.toThrow();
    expect(formatMoney(-1250, 'USD', 'en-US')).toBe('-$12.50');
  });
});

describe('formatting without the symbol', () => {
  it('keeps the currency fraction digits but drops the symbol', () => {
    expect(formatAmountOnly(1250, 'USD', 'en-US')).toBe('12.50');
    expect(formatAmountOnly(125, 'JPY', 'en-US')).toBe('125');
    expect(formatAmountOnly(128_450, 'USD', 'en-US')).toBe('1,284.50');
  });
});
