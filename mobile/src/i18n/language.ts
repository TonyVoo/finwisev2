/**
 * Which language the app speaks, and which `Intl` locale its dates and numbers use.
 *
 * Two small decisions live here and nowhere else:
 *
 * - **A preference is `system`, `en` or `vi`.** `system` follows the phone: Vietnamese on a
 *   Vietnamese phone, English on every other, because English is the one language the whole
 *   app is guaranteed to have. A phone set to French therefore gets English text, not a
 *   half-translated screen.
 * - **Formatting follows the choice, not just the phone.** Someone who picks Vietnamese on an
 *   English phone expects `1.234,50` and `tháng 10`, so an explicit language pins the `Intl`
 *   locale. `system` leaves it `undefined`, which is the device's own - exactly what the app
 *   did before it had languages, so choosing nothing changes nothing.
 */

export type Language = 'en' | 'vi';
export type LanguagePreference = 'system' | Language;

export const LANGUAGES: readonly Language[] = ['en', 'vi'];
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', 'en', 'vi'];

/** What the stored value means; anything unrecognised is `system`, never an error. */
export function parseLanguagePreference(raw: string | null | undefined): LanguagePreference {
  return raw === 'en' || raw === 'vi' ? raw : 'system';
}

let deviceLocaleOverride: string | null | undefined;

/**
 * Pin what the phone "says" its locale is. Tests use it so a suite does not change its answer
 * according to the language of the machine it happens to run on; the app never calls it.
 */
export function setDeviceLocaleOverride(locale: string | null | undefined): void {
  deviceLocaleOverride = locale;
}

/** The phone's own locale (`vi-VN`), or null where the runtime does not say. */
export function deviceLocale(): string | null {
  if (deviceLocaleOverride !== undefined) return deviceLocaleOverride;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale ?? null;
  } catch {
    return null;
  }
}

/** The language a locale tag names, if the app has it: `vi-VN` and `vi` are Vietnamese. */
export function languageOfLocale(locale: string | null | undefined): Language | null {
  const primary = locale?.split(/[-_]/)[0]?.toLowerCase();
  return LANGUAGES.find((language) => language === primary) ?? null;
}

export function resolveLanguage(
  preference: LanguagePreference,
  device: string | null = deviceLocale(),
): Language {
  if (preference !== 'system') return preference;
  return languageOfLocale(device) ?? 'en';
}

/**
 * The `Intl` locale to format with. `undefined` means the device's own, which is what every
 * formatter did before languages existed.
 */
export function intlLocaleFor(preference: LanguagePreference): string | undefined {
  if (preference === 'system') return undefined;
  return preference === 'vi' ? 'vi-VN' : 'en-US';
}

let activeIntlLocale: string | undefined;

/** Read by `lib/money`, `lib/calendar` and `lib/relativeTime` when a caller passes no locale. */
export function getActiveIntlLocale(): string | undefined {
  return activeIntlLocale;
}

export function setActiveIntlLocale(locale: string | undefined): void {
  activeIntlLocale = locale;
}
