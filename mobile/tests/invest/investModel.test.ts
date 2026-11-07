import { setActiveIntlLocale } from '@/i18n/language';
import { cleanSymbol, formatChange, formatShare, parseWhole, readCalc } from '@/invest/investModel';

describe('cleanSymbol', () => {
  it('trims and upper-cases a ticker', () => {
    expect(cleanSymbol('  vnm ')).toBe('VNM');
    expect(cleanSymbol('VNINDEX')).toBe('VNINDEX');
  });

  it.each(['', '  ', 'a-b', 'VN M', 'ABCDEFGHIJK', 'cổ'])('refuses %j', (text) => {
    expect(cleanSymbol(text)).toBeNull();
  });
});

describe('parseWhole', () => {
  it('reads digits whatever the thousands separator', () => {
    expect(parseWhole('1.250.000')).toBe(1250000);
    expect(parseWhole('1,250,000')).toBe(1250000);
    expect(parseWhole('1 250 000')).toBe(1250000);
  });

  it('never reads a decimal as one: the point is a separator', () => {
    expect(parseWhole('50.5')).toBe(505);
  });

  it.each(['', 'abc', '0', '000'])('gives nothing for %j', (text) => {
    expect(parseWhole(text)).toBeNull();
  });

  it('refuses a number past what the contract accepts', () => {
    expect(parseWhole('99999999999999')).toBeNull();
  });
});

describe('readCalc', () => {
  it('reads three numbers', () => {
    expect(readCalc('100.000.000', '50.000', '47.000')).toEqual({
      ok: true,
      input: { capital: 100000000, entry: 50000, stop: 47000 },
    });
  });

  it('asks for all three when one is missing', () => {
    expect(readCalc('100000000', '', '47000')).toEqual({ ok: false, problem: 'enterAll' });
  });

  it('refuses a stop at or above the entry', () => {
    expect(readCalc('100000000', '50000', '50000')).toEqual({
      ok: false,
      problem: 'stopBelowEntry',
    });
    expect(readCalc('100000000', '50000', '51000')).toEqual({
      ok: false,
      problem: 'stopBelowEntry',
    });
  });
});

describe('readCalc ceilings', () => {
  it('refuses numbers the contract would, instead of blaming the stop-loss', () => {
    expect(readCalc('100000000', '2000000000', '1000')).toEqual({ ok: false, problem: 'tooLarge' });
    expect(readCalc('100000000', '50000', '1999999999')).toEqual({
      ok: false,
      problem: 'tooLarge',
    });
    // Past thirteen digits there is no number to read at all.
    expect(readCalc('99999999999999', '50000', '1000')).toEqual({ ok: false, problem: 'enterAll' });
  });
});

describe('formatting', () => {
  it("writes percentages in the phone's own number style", () => {
    setActiveIntlLocale('vi-VN');
    try {
      expect(formatChange(0.0123)).toBe('+1,2%');
      expect(formatShare(0.2003)).toBe('20%');
    } finally {
      setActiveIntlLocale(undefined);
    }
  });

  it('signs movement and rounds to one decimal', () => {
    expect(formatChange(0.0053)).toBe('+0.5%');
    expect(formatChange(-0.0214)).toBe('-2.1%');
    expect(formatChange(0)).toBe('0%');
    expect(formatChange(null)).toBe('');
  });

  it('writes a share of capital', () => {
    expect(formatShare(0.01277)).toBe('1.3%');
    expect(formatShare(0.2003)).toBe('20%');
  });
});
