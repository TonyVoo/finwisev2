import { z } from 'zod';
import { LIMITS } from '@expense-tracker/shared';
import { ModelAnswerError } from './modelReading.ts';

/**
 * What a model writes for a month's recap, checked before anyone sees it: `docs/design/16-monthly-insights.md`.
 *
 * The model only rewords sentences the phone computed, so the one thing that must never get through is a
 * figure the facts did not contain. The check is on numbers, not on tone: every number in the text must
 * appear in the facts (or be the month or year of the request), compared by digits so `1,284.50` and
 * `1284.50` agree. A text that is empty, too long, or holds a link or markdown is refused too. Anything
 * refused is a failed answer; the text itself is never put in an error.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The month in words, in the language the recap is written in. `month` is `YYYY-MM`. */
export function monthLabel(month: string, language: 'en' | 'vi'): string {
  const year = month.slice(0, 4);
  const number = Number(month.slice(5, 7));
  return language === 'vi' ? `tháng ${number} năm ${year}` : `${MONTHS[number - 1]} ${year}`;
}

const Answer = z.object({ text: z.string() });

const NUMBER = /\d[\d.,]*/g;
/** A link, or markdown the card would show as stray symbols. */
const FORBIDDEN = /(https?:\/\/|www\.|\*\*|`|\]\()/i;

/** A number as its digits only, without leading zeros: `1,284.50` and `1284.50` are both `128450`. */
function digits(token: string): string {
  return token.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export function normalizeRecapAnswer(
  answer: unknown,
  options: { readonly month: string; readonly facts: readonly string[] },
): string {
  const parsed = Answer.safeParse(answer);
  if (!parsed.success) throw new ModelAnswerError();

  const text = parsed.data.text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0 || text.length > LIMITS.RECAP_TEXT_MAX) throw new ModelAnswerError();
  if (FORBIDDEN.test(text)) throw new ModelAnswerError();

  const allowed = new Set<string>([
    digits(options.month.slice(0, 4)),
    digits(options.month.slice(5, 7)),
  ]);
  for (const fact of options.facts) {
    for (const match of fact.matchAll(NUMBER)) allowed.add(digits(match[0]));
  }
  for (const match of text.matchAll(NUMBER)) {
    if (!allowed.has(digits(match[0]))) throw new ModelAnswerError();
  }
  return text;
}
