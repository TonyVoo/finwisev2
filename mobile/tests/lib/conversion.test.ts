import { convertMinor, impliedRate, isValidRate } from '@/lib/conversion';

/**
 * Converting an amount between currencies, in integers. A rate is a decimal *string* that is
 * scaled to an integer before any arithmetic, so no step of this goes through a float: the
 * product of a stored amount and a rate is exactly where a float would first go wrong.
 */

describe('isValidRate', () => {
  it.each(['1', '0.92', '1.0823', '151.25', '0.00000710', '12345.6789'])('accepts %s', (rate) => {
    expect(isValidRate(rate)).toBe(true);
  });

  it.each([
    '',
    ' ',
    '0',
    '0.0',
    '0.000000000',
    '-1',
    '1e5',
    '1,5',
    'abc',
    '1.',
    '.5',
    '1.123456789',
  ])('refuses %j', (rate) => {
    expect(isValidRate(rate)).toBe(false);
  });

  it('trims surrounding spaces', () => {
    expect(isValidRate(' 1.5 ')).toBe(true);
  });
});

describe('convertMinor', () => {
  it('converts between two-decimal currencies', () => {
    // EUR 10.00 at 1.0823 -> USD 10.823 -> USD 10.82
    expect(
      convertMinor({ amountMinor: 1000, fromDecimals: 2, toDecimals: 2, rate: '1.0823' }),
    ).toBe(1082);
  });

  it('rounds half up, on the amount and not on a float', () => {
    // 0.5 cent either side of the line.
    expect(convertMinor({ amountMinor: 1, fromDecimals: 2, toDecimals: 2, rate: '1.5' })).toBe(2);
    expect(convertMinor({ amountMinor: 1, fromDecimals: 2, toDecimals: 2, rate: '1.4999' })).toBe(
      1,
    );
    // The classic float trap: 1.005 * 100 is 100.49999999999999 in floating point.
    expect(convertMinor({ amountMinor: 100, fromDecimals: 2, toDecimals: 2, rate: '1.005' })).toBe(
      101,
    );
  });

  it('handles a zero-decimal currency on either side', () => {
    // JPY 1000 (no minor unit) at 0.0067 -> USD 6.70 -> 670 cents
    expect(
      convertMinor({ amountMinor: 1000, fromDecimals: 0, toDecimals: 2, rate: '0.0067' }),
    ).toBe(670);
    // USD 6.70 at 149.25 -> JPY 999.975 -> 1000
    expect(convertMinor({ amountMinor: 670, fromDecimals: 2, toDecimals: 0, rate: '149.25' })).toBe(
      1000,
    );
  });

  it('is exact at the largest amounts, where a float is not', () => {
    // 999_999_999_999 * 1 must come back unchanged; a double product would drift.
    expect(
      convertMinor({ amountMinor: 999_999_999_999, fromDecimals: 2, toDecimals: 2, rate: '1' }),
    ).toBe(999_999_999_999);
    expect(
      convertMinor({
        amountMinor: 123_456_789_012,
        fromDecimals: 2,
        toDecimals: 2,
        rate: '1.00000001',
      }),
    ).toBe(123_456_790_247);
  });

  it('returns null when the result would exceed the largest storable amount', () => {
    expect(
      convertMinor({ amountMinor: 999_999_999_999, fromDecimals: 2, toDecimals: 2, rate: '2' }),
    ).toBeNull();
  });

  it('returns null for a rate that is not valid, and 0 for a zero amount', () => {
    expect(
      convertMinor({ amountMinor: 1000, fromDecimals: 2, toDecimals: 2, rate: 'x' }),
    ).toBeNull();
    expect(convertMinor({ amountMinor: 0, fromDecimals: 2, toDecimals: 2, rate: '1.5' })).toBe(0);
  });

  it('accepts a rate with surrounding spaces', () => {
    expect(convertMinor({ amountMinor: 1000, fromDecimals: 2, toDecimals: 2, rate: ' 2 ' })).toBe(
      2000,
    );
  });
});

describe('impliedRate', () => {
  it('works the rate back out of the two stored amounts', () => {
    expect(
      impliedRate({ originalMinor: 1000, originalDecimals: 2, homeMinor: 1082, homeDecimals: 2 }),
    ).toBe('1.082');
  });

  it('accounts for different minor units', () => {
    expect(
      impliedRate({ originalMinor: 1000, originalDecimals: 0, homeMinor: 670, homeDecimals: 2 }),
    ).toBe('0.0067');
  });

  it('trims trailing zeros and keeps at most eight decimals', () => {
    expect(
      impliedRate({ originalMinor: 100, originalDecimals: 2, homeMinor: 200, homeDecimals: 2 }),
    ).toBe('2');
    expect(
      impliedRate({ originalMinor: 3, originalDecimals: 2, homeMinor: 1, homeDecimals: 2 }),
    ).toBe('0.33333333');
  });

  it('is null when there is no original amount to divide by', () => {
    expect(
      impliedRate({ originalMinor: 0, originalDecimals: 2, homeMinor: 5, homeDecimals: 2 }),
    ).toBeNull();
  });

  it('round-trips: converting with the implied rate reproduces the home amount', () => {
    const rate = impliedRate({
      originalMinor: 1000,
      originalDecimals: 2,
      homeMinor: 1082,
      homeDecimals: 2,
    })!;
    expect(convertMinor({ amountMinor: 1000, fromDecimals: 2, toDecimals: 2, rate })).toBe(1082);
  });
});
