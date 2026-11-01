import { describe, expect, it } from 'vitest';
import { ModelAnswerError } from '../src/services/modelReading.ts';
import { monthLabel, normalizeRecapAnswer } from '../src/services/recapWriting.ts';

/**
 * What a model writes for a month's recap, checked before anyone sees it (`docs/design/16-monthly-insights.md`).
 * The model only rewords sentences the phone computed, so the one thing that must never get through is a
 * number the facts did not contain: the check is on figures, not on tone.
 */

const FACTS = [
  'You have spent 12% more than in September.',
  'Groceries is your biggest category, at 24% of the month.',
  "You have used 87% of Eating out's budget with 9 days left.",
  'You have kept US$1,284.50 of your income this month.',
];
const OCTOBER = { month: '2026-10', facts: FACTS };

const write = (text: unknown, options = OCTOBER) => normalizeRecapAnswer({ text }, options);

describe('monthLabel', () => {
  it('names the month in the language asked for', () => {
    expect(monthLabel('2026-10', 'en')).toBe('October 2026');
    expect(monthLabel('2026-02', 'en')).toBe('February 2026');
    expect(monthLabel('2026-10', 'vi')).toBe('tháng 10 năm 2026');
    expect(monthLabel('2026-02', 'vi')).toBe('tháng 2 năm 2026');
  });
});

describe('normalizeRecapAnswer', () => {
  it('passes a recap that uses only numbers from the facts', () => {
    const text =
      'October was a little heavier than September, with groceries at 24%. Eating out has used 87% of its budget with 9 days left.';
    expect(write(text)).toBe(text);
  });

  it('tidies whitespace and control characters', () => {
    expect(write('  Groceries led at 24%.\u0000\n\n  Nice.  ')).toBe('Groceries led at 24%. Nice.');
  });

  describe('the numbers check', () => {
    it('refuses a number that is not in the facts', () => {
      expect(() => write('Spending was up 15%.')).toThrow(ModelAnswerError);
      expect(() => write('You spent 3 times on groceries.')).toThrow(ModelAnswerError);
    });

    it('refuses a number that only looks like part of one in the facts', () => {
      // 8 and 7 are in "87", but the model wrote them alone.
      expect(() => write('You are 8% over.')).toThrow(ModelAnswerError);
    });

    it('accepts the same figure written with another separator or symbol', () => {
      expect(write('You kept $1284.50 this month.')).toBe('You kept $1284.50 this month.');
      expect(write('You kept 1.284,50 this month.')).toBe('You kept 1.284,50 this month.');
    });

    it('allows the month and the year of the recap itself, which the request names', () => {
      expect(write('In October 2026, groceries led at 24%.')).toBe(
        'In October 2026, groceries led at 24%.',
      );
      expect(write('Trong tháng 10, nhóm hàng tạp hóa dẫn đầu với 24%.')).toContain('tháng 10');
    });

    it('ignores the full stop that ends a sentence', () => {
      expect(write('Groceries led at 24%.')).toBe('Groceries led at 24%.');
      expect(write('Eating out has 9 days left.')).toBe('Eating out has 9 days left.');
    });

    it('allows text with no numbers at all', () => {
      expect(write('A steady month, with groceries on top.')).toBe(
        'A steady month, with groceries on top.',
      );
    });

    it('is checked against these facts, not against any others', () => {
      expect(() =>
        write('Groceries led at 24%.', { month: '2026-10', facts: ['It was a quiet month.'] }),
      ).toThrow(ModelAnswerError);
    });
  });

  describe('what a recap may not contain', () => {
    it.each([
      ['a link', 'See https://example.com for details.'],
      ['a web address', 'More at www.example.com.'],
      ['bold markdown', '**Groceries** led.'],
      ['a code span', 'Groceries `led`.'],
      ['a markdown link', 'Open [this](x) now.'],
    ])('refuses %s', (_name, text) => {
      expect(() => write(text)).toThrow(ModelAnswerError);
    });

    it('refuses an empty recap, or one longer than 500 characters', () => {
      expect(() => write('   ')).toThrow(ModelAnswerError);
      expect(() => write('a'.repeat(501))).toThrow(ModelAnswerError);
      expect(write('a'.repeat(500))).toHaveLength(500);
    });
  });

  describe('shape', () => {
    it.each([
      ['null', null],
      ['a string', 'Groceries led at 24%.'],
      ['an array', [{ text: 'x' }]],
      ['no text', {}],
      ['a text that is not a string', { text: 24 }],
    ])('rejects %s as a failed answer', (_name, answer) => {
      expect(() => normalizeRecapAnswer(answer, OCTOBER)).toThrow(ModelAnswerError);
    });

    it('never puts the text in the error', () => {
      try {
        write('Spending was up 99% for secret-sk-123.');
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).not.toContain('secret-sk-123');
        expect((error as Error).message).not.toContain('99');
      }
    });
  });
});
