import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIRM_COPY,
  COPY,
  EMPTY_COPY,
  GENERIC_ERROR,
  OFFLINE_COPY,
  SESSION_EXPIRED,
  SNACK_COPY,
  VALIDATION_COPY,
  categoryDeleteBody,
  categoryDeleted,
} from '@/copy/strings';

/**
 * Every string the app renders must be a string the Designer wrote.
 *
 * `docs/design/09-copy-deck.md` is authoritative for wording, so `src/copy/strings.ts`
 * is a transcription of it, and a transcription is exactly the kind of artefact that
 * drifts: a tweak lands in the deck and not in the app, or a developer "improves" a
 * sentence in the app and the deck no longer describes what ships. Both are invisible in
 * review. So this suite reads the design docs off disk and asserts each string still
 * appears in one of them verbatim.
 *
 * It checks *presence*, not placement. Which screen shows a string, and in which slot,
 * is the screen specs' business and is pinned by the screen tests.
 *
 * ### The one string that is not in the deck
 *
 * `signup.loginInstead` (`Log in instead`) is specified in `03-auth.md` §1.2 rule 4 and
 * has no row in the deck's §1 table. That is a gap in the deck rather than an invented
 * string, so the sources below include the auth spec and the last case names it
 * explicitly — if the deck gains the row later, that case is where it gets noticed.
 */

const DESIGN_DIR = join(__dirname, '..', '..', '..', 'docs', 'design');

const COPY_DECK = readFileSync(join(DESIGN_DIR, '09-copy-deck.md'), 'utf8');
const AUTH_SPEC = readFileSync(join(DESIGN_DIR, '03-auth.md'), 'utf8');

/** Every leaf string in a nested constant, keyed by its dotted path. */
function flatten(value: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof value === 'string') return [[path.join('.'), value]];
  if (typeof value !== 'object' || value === null) return [];

  return Object.entries(value).flatMap(([key, nested]) => flatten(nested, [...path, key]));
}

const ALL_STRINGS: Array<[string, string]> = [
  ...flatten(COPY),
  ...flatten(VALIDATION_COPY, ['validate']),
  ...flatten(OFFLINE_COPY, ['offline']),
  ...flatten({ generic: GENERIC_ERROR }, ['error']),
  ...flatten({ expired: SESSION_EXPIRED }, ['session']),
  // The templated strings are checked here too, braces and all. That is the reason they are
  // stored as deck-shaped templates rather than assembled from fragments by their
  // formatters: a sentence built out of pieces would put most of its wording beyond this
  // check, and wording is the one thing the deck is authoritative for.
  ...flatten(EMPTY_COPY, ['empty']),
  ...flatten(CONFIRM_COPY, ['confirm']),
  ...flatten(SNACK_COPY, ['snack']),
];

describe('copy strings are transcribed from the design docs', () => {
  it('found strings to check', () => {
    // Guards every case below: a renamed export would otherwise leave them iterating an
    // empty list and passing.
    expect(ALL_STRINGS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(ALL_STRINGS)('%s is written in the design docs', (_key, text) => {
    expect(`${COPY_DECK}\n${AUTH_SPEC}`).toContain(text);
  });

  it('sources every string except one from the copy deck itself', () => {
    const missingFromDeck = ALL_STRINGS.filter(([, text]) => !COPY_DECK.includes(text)).map(
      ([key]) => key,
    );

    // `Log in instead` lives in the screen spec's rule 4 and has no deck row. Listed
    // here rather than skipped, so a second string going the same way fails loudly
    // instead of joining a silent exception list.
    expect(missingFromDeck).toEqual(['signup.loginInstead']);
  });

  it('leaves no placeholder unfilled in a formatted string', () => {
    // A `{count}` that reached a user would be the formatter and its template having
    // fallen out of step. `fill` throws on an unknown key, so this asserts the templates
    // above name only placeholders their formatters actually pass.
    const formatted = [
      categoryDeleteBody(0, 'Uncategorized'),
      categoryDeleteBody(1, 'Uncategorized'),
      categoryDeleteBody(23, 'Uncategorized'),
      categoryDeleted('Health', 0, 'Uncategorized'),
      categoryDeleted('Health', 1, 'Uncategorized'),
      categoryDeleted('Health', 23, 'Uncategorized'),
    ];

    for (const text of formatted) {
      expect({ text, hasPlaceholder: /[{}]/.test(text) }).toEqual({ text, hasPlaceholder: false });
    }
  });

  describe('the count-branching copy', () => {
    // Deck §0: "Every string with a count has an explicit singular form — there is no
    // `(s)` anywhere." These cases pin the boundaries, because an off-by-one in the
    // branch is invisible until a user deletes a category holding exactly one expense.
    it('promises the move in the plural, the singular, and not at all', () => {
      expect(categoryDeleteBody(23, 'Uncategorized')).toBe(
        "Its 23 expenses will move to Uncategorized. They won't be deleted.",
      );
      expect(categoryDeleteBody(1, 'Uncategorized')).toBe(
        "Its 1 expense will move to Uncategorized. It won't be deleted.",
      );
      // No count and no promise about expenses: there are none to reassure anyone about.
      expect(categoryDeleteBody(0, 'Uncategorized')).toBe('It has no expenses.');
    });

    it('reports what the delete actually did', () => {
      expect(categoryDeleted('Health', 23, 'Uncategorized')).toBe(
        'Health deleted. 23 expenses moved to Uncategorized.',
      );
      expect(categoryDeleted('Health', 1, 'Uncategorized')).toBe(
        'Health deleted. 1 expense moved to Uncategorized.',
      );
      expect(categoryDeleted('Health', 0, 'Uncategorized')).toBe('Health deleted.');
    });

    it('interpolates the fallback name rather than hardcoding Uncategorized', () => {
      // §4 rule 3: the user may have renamed the `isDefault` row, and both the dialog and
      // the snackbar have to say what it is called now, not what it shipped as.
      expect(categoryDeleteBody(2, 'Later')).toContain('will move to Later.');
      expect(categoryDeleted('Health', 2, 'Later')).toContain('moved to Later.');
      expect(categoryDeleteBody(2, 'Later')).not.toContain('Uncategorized');
    });
  });

  it('keeps the two blocking-offline strings distinct', () => {
    // The whole point of these two: `03-auth.md` says each names the action that is
    // blocked rather than announcing that the network is down, so they cannot collapse
    // into one shared "no connection" string.
    expect(OFFLINE_COPY.signup).not.toBe(OFFLINE_COPY.login);
  });

  it('punctuates sentences and leaves labels unpunctuated', () => {
    // Deck §0 rule 5, and it is a screen-reader concern rather than a style one: an
    // unpunctuated sentence runs into the next element.
    const sentences = [
      ...flatten(VALIDATION_COPY),
      ...flatten(OFFLINE_COPY),
      ['error.generic', GENERIC_ERROR] as [string, string],
      ['session.expired', SESSION_EXPIRED] as [string, string],
    ];
    for (const [key, text] of sentences) {
      expect({ [key]: text.endsWith('.') }).toEqual({ [key]: true });
    }

    const labels = [
      COPY.signup.submit,
      COPY.login.submit,
      COPY.welcome.cta.signup,
      COPY.welcome.cta.login,
      COPY.settings.logout,
      COPY.common.back,
      COPY.signup.field.email,
      COPY.signup.field.password,
      // Not a full sentence, so no full stop, even though it reads as a hint.
      COPY.signup.field.passwordHint,
    ];
    for (const label of labels) {
      expect({ label, punctuated: label.endsWith('.') }).toEqual({ label, punctuated: false });
    }
  });
});
