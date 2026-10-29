import { describe, expect, it } from 'vitest';
import {
  formatSummary,
  newTally,
  parseScanArgs,
  parseExpected,
  recordScore,
  scoreReading,
} from '../src/scripts/receiptScoring.ts';

/**
 * The pure half of `pnpm scan:receipts`: reading its arguments, and scoring a reading against what
 * a person wrote down as the truth. A wrong value costs the user more than a missing one, so the
 * score keeps them apart (`docs/design/14-ai-receipt-reading.md`, "Checking it is better").
 */

const found = {
  amountMinor: 1250,
  date: '2026-10-14',
  merchant: 'Milk Mart',
  category: 'groceries' as const,
};

describe('parseScanArgs', () => {
  it('takes a folder, and defaults to USD and the OCR reader like before', () => {
    expect(parseScanArgs(['./photos'])).toEqual({
      folder: './photos',
      currency: 'USD',
      reader: 'ocr',
    });
  });

  it('takes a currency as the second positional argument', () => {
    expect(parseScanArgs(['./photos', 'VND'])).toMatchObject({ currency: 'VND' });
  });

  it.each([
    [['--reader', 'gemini', './p'], 'gemini'],
    [['./p', '--reader=both'], 'both'],
    [['./p', 'EUR', '--reader', 'ocr'], 'ocr'],
  ])('reads --reader in %j', (argv, reader) => {
    expect(parseScanArgs(argv)).toMatchObject({ folder: './p', reader });
  });

  it('rejects an unknown reader, an unknown flag and a missing value', () => {
    expect(() => parseScanArgs(['./p', '--reader', 'magic'])).toThrow(/gemini\|ocr\|both/);
    expect(() => parseScanArgs(['./p', '--fast'])).toThrow(/--fast/);
    expect(() => parseScanArgs(['./p', '--reader'])).toThrow(/--reader/);
  });

  it('needs a folder', () => {
    expect(() => parseScanArgs([])).toThrow(/usage/);
    expect(() => parseScanArgs(['--reader', 'both'])).toThrow(/usage/);
  });
});

describe('parseExpected', () => {
  it('reads the four fields, null meaning "there is none on this receipt"', () => {
    expect(
      parseExpected(
        JSON.stringify({ amountMinor: 1250, date: null, merchant: 'Milk Mart', category: 'bills' }),
      ),
    ).toEqual({ amountMinor: 1250, date: null, merchant: 'Milk Mart', category: 'bills' });
  });

  it('leaves out fields that are not written, so they are not scored', () => {
    expect(parseExpected('{"amountMinor": 500}')).toEqual({ amountMinor: 500 });
  });

  it.each([
    ['not JSON', 'amount: 5'],
    ['an array', '[]'],
    ['a string amount', '{"amountMinor":"12.50"}'],
    ['a fractional amount', '{"amountMinor":12.5}'],
    ['a zero amount', '{"amountMinor":0}'],
    ['a bad date', '{"date":"14/10/2026"}'],
    ['an unknown category', '{"category":"yachts"}'],
    ['an unknown field', '{"total":5}'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseExpected(text)).toThrow();
  });
});

describe('scoreReading', () => {
  it('marks every field correct when all match', () => {
    expect(scoreReading(found, found)).toEqual({
      amountMinor: 'correct',
      date: 'correct',
      merchant: 'correct',
      category: 'correct',
    });
  });

  it('separates a wrong value from a missed one', () => {
    const score = scoreReading(
      { ...found, amountMinor: 1520, date: null },
      { amountMinor: 1250, date: '2026-10-14' },
    );
    expect(score.amountMinor).toBe('wrong');
    expect(score.date).toBe('missed');
  });

  it('counts a value where none was expected as wrong, and null where none was expected as correct', () => {
    const score = scoreReading(
      { ...found, date: '2026-10-14', category: null },
      { date: null, category: null },
    );
    expect(score.date).toBe('wrong');
    expect(score.category).toBe('correct');
  });

  it('does not score fields the expected file does not mention', () => {
    expect(scoreReading(found, { amountMinor: 1250 })).toEqual({ amountMinor: 'correct' });
  });

  describe('merchant', () => {
    const merchant = (actual: string | null, expected: string | null) =>
      scoreReading({ ...found, merchant: actual }, { merchant: expected }).merchant;

    it('ignores case, accents, spacing and punctuation', () => {
      expect(merchant('  CỬA HÀNG   Minh. ', 'Cua hang Minh')).toBe('correct');
    });

    it('accepts one name containing the other, as receipts print more or less of it', () => {
      expect(merchant('Milk Mart Downtown Branch', 'Milk Mart')).toBe('correct');
      expect(merchant('Milk Mart', 'Milk Mart Downtown Branch')).toBe('correct');
    });

    it('does not accept a short fragment as a match', () => {
      expect(merchant('Mi', 'Milk Mart')).toBe('wrong');
    });

    it('is wrong for another shop', () => {
      expect(merchant('Fresh Market', 'Milk Mart')).toBe('wrong');
    });
  });
});

describe('summary', () => {
  it('adds up outcomes per field', () => {
    const tally = newTally();
    recordScore(tally, { amountMinor: 'correct', date: 'missed' });
    recordScore(tally, { amountMinor: 'wrong', date: 'correct', merchant: 'correct' });
    expect(tally.amountMinor).toEqual({ correct: 1, wrong: 1, missed: 0 });
    expect(tally.date).toEqual({ correct: 1, wrong: 0, missed: 1 });
    expect(tally.merchant).toEqual({ correct: 1, wrong: 0, missed: 0 });
    expect(tally.category).toEqual({ correct: 0, wrong: 0, missed: 0 });
  });

  it('prints one line per scored field per reader, wrong before missed, and skips unscored fields', () => {
    const ocr = newTally();
    recordScore(ocr, { amountMinor: 'wrong', date: 'missed' });
    const gemini = newTally();
    recordScore(gemini, { amountMinor: 'correct', date: 'correct' });

    const text = formatSummary({ ocr, gemini });

    expect(text).toMatch(/amount\s+ocr\s+correct 0\s+wrong 1\s+missed 0/);
    expect(text).toMatch(/amount\s+gemini\s+correct 1\s+wrong 0\s+missed 0/);
    expect(text).toMatch(/date\s+ocr\s+correct 0\s+wrong 0\s+missed 1/);
    expect(text).not.toMatch(/merchant/);
    expect(text).not.toMatch(/category/);
  });

  it('says so when nothing had an expected file', () => {
    expect(formatSummary({ ocr: newTally() })).toMatch(/no .expected.json/i);
  });
});
