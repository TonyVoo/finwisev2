import { ENGLISH_COPY, LIVE_COPY, applyLanguagePreference } from '@/i18n/apply';
import { VIETNAMESE_COPY } from '@/copy/vi';

/**
 * The two language bundles must say the same things, in the same places.
 *
 * TypeScript already refuses a Vietnamese bundle with a missing key. What it cannot see is
 * inside the strings, and that is where a translation does real damage: dropping `{count}`
 * renders a sentence with no number in it, and inventing `{total}` throws in `fill` on a
 * user's phone. So every string's set of `{placeholders}` is compared, not just its key.
 */

function flatten(value: unknown, path: string[] = []): [string, string][] {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, next]) => flatten(next, [...path, key]));
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();

const english = new Map(flatten(ENGLISH_COPY));
const vietnamese = new Map(flatten(VIETNAMESE_COPY));

/**
 * Strings that are legitimately the same in both languages: a brand, a code or format, an
 * endonym, a loanword Vietnamese uses as is, or a template that is only placeholders. Listed
 * rather than skipped, so a string someone forgets to translate fails here instead of
 * joining a silent exception.
 */
const SAME_IN_BOTH = new Set([
  'COPY.app.name',
  'COPY.signup.field.email',
  'COPY.settings.email',
  'COPY.language.en',
  'COPY.language.vi',
  'COPY.currencyNames.EUR',
  'COPY.recurring.field.datePlaceholder',
  'COPY.recurring.reminder.body',
  'COPY.form.rate.hint',
  'COPY.form.rate.converted',
]);

describe('the Vietnamese bundle', () => {
  it('has found strings to compare', () => {
    expect(english.size).toBeGreaterThan(400);
  });

  it('has exactly the English keys, no more and no fewer', () => {
    expect([...vietnamese.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it.each([...english.keys()])('%s has the same {placeholders} in both languages', (key) => {
    expect(placeholders(vietnamese.get(key)!)).toEqual(placeholders(english.get(key)!));
  });

  it('leaves no string empty or padded', () => {
    for (const [key, text] of vietnamese) {
      expect({ key, text: text.trim() }).toEqual({ key, text: text.trim() });
      expect({ key, empty: text.trim() === '' }).toEqual({ key, empty: false });
      expect({ key, padded: text !== text.trim() }).toEqual({ key, padded: false });
    }
  });

  it('translates everything except the listed strings that are the same in both', () => {
    const untranslated = [...english.keys()].filter(
      (key) => english.get(key) === vietnamese.get(key),
    );
    expect(untranslated.sort()).toEqual([...SAME_IN_BOTH].sort());
  });

  it('only lists same-in-both strings that exist', () => {
    for (const key of SAME_IN_BOTH) expect(english.has(key)).toBe(true);
  });

  it('writes Vietnamese, not English with the accents missing', () => {
    // A cheap tell for an untranslated sentence: Vietnamese prose is full of diacritics.
    const prose = [...vietnamese].filter(
      ([key, text]) => text.length > 40 && !SAME_IN_BOTH.has(key),
    );
    for (const [key, text] of prose) {
      expect({ key, hasDiacritics: /[À-ỹ]/.test(text) }).toEqual({ key, hasDiacritics: true });
    }
  });

  it('keeps punctuation conventions: sentences end in a full stop, buttons do not', () => {
    // The deck's voice rule (`docs/design/09-copy-deck.md` §0), applied to both languages.
    const sentenceKeys = [...english.keys()].filter((key) => english.get(key)!.endsWith('.'));
    for (const key of sentenceKeys) {
      const text = vietnamese.get(key)!;
      // `…` and `?` close their own sentences; only a bare missing stop is a slip.
      expect({ key, ok: /[.?…!]$/.test(text) }).toEqual({ key, ok: true });
    }
  });
});

describe('switching language', () => {
  afterEach(() => {
    applyLanguagePreference('en');
  });

  it('starts in English', () => {
    expect(LIVE_COPY.COPY.home.title).toBe('Expenses');
  });

  it('overwrites the live strings with Vietnamese, in every group', () => {
    applyLanguagePreference('vi');

    expect(LIVE_COPY.COPY.home.title).toBe('Chi tiêu');
    expect(LIVE_COPY.VALIDATION_COPY.email.empty).toBe('Nhập địa chỉ email của bạn.');
    expect(LIVE_COPY.OFFLINE_COPY.login).toBe('Bạn cần có mạng để đăng nhập.');
    expect(LIVE_COPY.EMPTY_COPY.home.firstRun.headline).toBe('Chưa có khoản chi nào');
    expect(LIVE_COPY.CONFIRM_COPY.discard.confirm).toBe('Bỏ');
    expect(LIVE_COPY.SNACK_COPY.expense.saved).toBe('Đã lưu khoản chi.');
    expect(LIVE_COPY.SYNC_COPY.pill.offline).toBe('Ngoại tuyến');
    expect(LIVE_COPY.RELATIVE_TIME_COPY.justNow).toBe('vừa xong');
  });

  it('restores English exactly when switched back', () => {
    applyLanguagePreference('vi');
    applyLanguagePreference('en');

    expect(flatten(LIVE_COPY)).toEqual(flatten(ENGLISH_COPY));
  });

  it('can hop between languages repeatedly without drifting', () => {
    for (let i = 0; i < 5; i += 1) {
      applyLanguagePreference('vi');
      applyLanguagePreference('en');
    }
    expect(flatten(LIVE_COPY)).toEqual(flatten(ENGLISH_COPY));
  });

  it('returns the language it resolved to', () => {
    expect(applyLanguagePreference('vi')).toBe('vi');
    expect(applyLanguagePreference('en')).toBe('en');
  });

  it('follows the phone for `system`, and falls back to English for a language it lacks', () => {
    expect(applyLanguagePreference('system', 'vi-VN')).toBe('vi');
    expect(LIVE_COPY.COPY.home.title).toBe('Chi tiêu');
    expect(applyLanguagePreference('system', 'fr-FR')).toBe('en');
    expect(LIVE_COPY.COPY.home.title).toBe('Expenses');
    expect(applyLanguagePreference('system', null)).toBe('en');
  });
});
