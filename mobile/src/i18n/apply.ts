import {
  CONFIRM_COPY,
  COPY,
  EMPTY_COPY,
  OFFLINE_COPY,
  RELATIVE_TIME_COPY,
  SNACK_COPY,
  SYNC_COPY,
  VALIDATION_COPY,
} from '../copy/strings';
import { VIETNAMESE_COPY } from '../copy/vi';
import {
  type Language,
  type LanguagePreference,
  intlLocaleFor,
  resolveLanguage,
  setActiveIntlLocale,
} from './language';

/**
 * Switching the app's language, in place.
 *
 * Every string the app shows is a leaf of one of the copy objects below, and every reader -
 * screens, formatters, error presenters - reads it through `COPY.x.y` at the moment it
 * renders. So a language switch does not need a lookup layer threaded through sixty files: it
 * overwrites the leaves of those same objects with the other language's text, and the next
 * render says the new words. The English source is kept as a snapshot taken before anything
 * is overwritten, so switching back restores it exactly.
 *
 * What makes this safe rather than clever is that the shape is checked twice: the Vietnamese
 * bundle is typed as {@link Translated} of the English one, so a missing key does not
 * compile, and `tests/i18n/` asserts that every key and every `{placeholder}` agrees at
 * runtime. A translation that dropped `{count}` would otherwise render a sentence with no
 * number in it, and one that invented `{total}` would throw in `fill` on a user's phone.
 */

/** The live objects the app reads from. Overwritten leaf by leaf on a language switch. */
export const LIVE_COPY = {
  COPY,
  VALIDATION_COPY,
  OFFLINE_COPY,
  EMPTY_COPY,
  CONFIRM_COPY,
  SNACK_COPY,
  SYNC_COPY,
  RELATIVE_TIME_COPY,
};

/** The same shape with every string leaf free to be any string, not the English literal. */
export type Translated<T> = T extends string
  ? string
  : T extends object
    ? { -readonly [K in keyof T]: Translated<T[K]> }
    : T;

export type CopyBundle = Translated<typeof LIVE_COPY>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Taken at import, before any language has been applied. */
export const ENGLISH_COPY: CopyBundle = clone(LIVE_COPY) as CopyBundle;

function assignLeaves(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') {
      target[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      const next = target[key];
      if (typeof next === 'object' && next !== null) {
        assignLeaves(next as Record<string, unknown>, value as Record<string, unknown>);
      }
    }
  }
}

export function bundleFor(language: Language): CopyBundle {
  return language === 'vi' ? VIETNAMESE_COPY : ENGLISH_COPY;
}

/**
 * Make the app speak `preference`: the text, and the `Intl` locale its dates and numbers use.
 * Returns the language it resolved to.
 */
export function applyLanguagePreference(
  preference: LanguagePreference,
  device?: string | null,
): Language {
  const language = resolveLanguage(preference, device);
  // English first, then the other language over it: a leaf the Vietnamese bundle somehow
  // lacks falls back to English instead of rendering `undefined`.
  assignLeaves(LIVE_COPY as unknown as Record<string, unknown>, ENGLISH_COPY);
  if (language !== 'en') {
    assignLeaves(LIVE_COPY as unknown as Record<string, unknown>, bundleFor(language));
  }
  setActiveIntlLocale(intlLocaleFor(preference));
  return language;
}
