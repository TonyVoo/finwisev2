import { COPY } from '@/copy/strings';
import { VIETNAMESE_COPY } from '@/copy/vi';
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY_CODE,
  currencyForLocale,
  currencyLabel,
  currencyName,
} from '@/lib/currencies';
import { currencyDecimals } from '@/lib/money';

/**
 * The currencies the app offers (`lib/currencies.ts`). A currency a person actually spends in has to be
 * here: the one chosen at signup decides how every amount is shown and whether the keypad has a decimal key.
 */

const codes = CURRENCY_OPTIONS.map((option) => option.code);

describe('the currency list', () => {
  it('offers the Vietnamese dong, among the first few, since the app is used in Vietnam', () => {
    expect(codes).toContain('VND');
    expect(codes.indexOf('VND')).toBeLessThan(6);
    expect(currencyLabel('VND')).toBe('VND - Vietnamese Dong');
  });

  it('covers the currencies a traveller or an Asian-Pacific household spends in', () => {
    for (const code of [
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'CNY',
      'KRW',
      'THB',
      'SGD',
      'MYR',
      'IDR',
      'PHP',
      'HKD',
      'AUD',
    ]) {
      expect(codes).toContain(code);
    }
  });

  it('has each code once, in the form the contract takes, and still starts on USD', () => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
    expect(codes[0]).toBe(DEFAULT_CURRENCY_CODE);
  });

  it('names every currency in English and in Vietnamese, so no row reads "USD - USD"', () => {
    for (const code of codes) {
      const english = (COPY.currencyNames as Record<string, string>)[code];
      const vietnamese = (VIETNAMESE_COPY.COPY.currencyNames as Record<string, string>)[code];
      expect({ code, english: typeof english, vietnamese: typeof vietnamese }).toEqual({
        code,
        english: 'string',
        vietnamese: 'string',
      });
    }
  });

  it('names no currency that is not offered, in either language', () => {
    expect(Object.keys(COPY.currencyNames).sort()).toEqual([...codes].sort());
    expect(Object.keys(VIETNAMESE_COPY.COPY.currencyNames).sort()).toEqual([...codes].sort());
  });

  it('labels an unknown code as itself rather than a blank row', () => {
    expect(currencyName('XXX')).toBeNull();
    expect(currencyLabel('XXX')).toBe('XXX');
  });
});

describe('the minor unit of the currencies offered', () => {
  it('is none for the dong, the won and the yen, so the keypad has no decimal key', () => {
    for (const code of ['VND', 'KRW', 'JPY']) expect(currencyDecimals(code)).toBe(0);
  });

  it('is two for the dollar, the euro and the baht', () => {
    for (const code of ['USD', 'EUR', 'THB', 'SGD']) expect(currencyDecimals(code)).toBe(2);
  });
});

describe('the currency preselected at signup', () => {
  it.each([
    ['vi-VN', 'VND'],
    ['en-US', 'USD'],
    ['de-DE', 'EUR'],
    ['fr_FR', 'EUR'],
    ['en-GB', 'GBP'],
    ['ja-JP', 'JPY'],
    ['pt-BR', 'BRL'],
    ['en-AU', 'AUD'],
  ])('is chosen from the region of %s', (locale, expected) => {
    expect(currencyForLocale(locale)).toBe(expected);
  });

  it('falls back to the default for a region not on the list, or none at all', () => {
    expect(currencyForLocale('en-ZZ')).toBe(DEFAULT_CURRENCY_CODE);
    expect(currencyForLocale('en')).toBe(DEFAULT_CURRENCY_CODE);
    expect(currencyForLocale(undefined)).toBe(DEFAULT_CURRENCY_CODE);
  });

  it('only ever picks a currency the app offers', () => {
    for (const locale of ['vi-VN', 'de-DE', 'en-GB', 'ja-JP', 'pt-BR', 'en-ZA', 'ar-AE', 'es-MX']) {
      expect(codes).toContain(currencyForLocale(locale));
    }
  });
});
