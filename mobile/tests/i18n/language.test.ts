import {
  intlLocaleFor,
  languageOfLocale,
  parseLanguagePreference,
  resolveLanguage,
} from '@/i18n/language';

describe('parseLanguagePreference', () => {
  it('accepts the three values and treats anything else as system', () => {
    expect(parseLanguagePreference('en')).toBe('en');
    expect(parseLanguagePreference('vi')).toBe('vi');
    expect(parseLanguagePreference('system')).toBe('system');
    expect(parseLanguagePreference(null)).toBe('system');
    expect(parseLanguagePreference(undefined)).toBe('system');
    expect(parseLanguagePreference('fr')).toBe('system');
    expect(parseLanguagePreference('')).toBe('system');
  });
});

describe('languageOfLocale', () => {
  it.each([
    ['vi', 'vi'],
    ['vi-VN', 'vi'],
    ['vi_VN', 'vi'],
    ['VI-vn', 'vi'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
  ])('%s is %s', (locale, language) => {
    expect(languageOfLocale(locale)).toBe(language);
  });

  it.each(['fr-FR', 'de', 'zh-Hans-CN', '', null, undefined])('%s is not offered', (locale) => {
    expect(languageOfLocale(locale)).toBeNull();
  });
});

describe('resolveLanguage', () => {
  it('uses an explicit choice whatever the phone says', () => {
    expect(resolveLanguage('vi', 'en-US')).toBe('vi');
    expect(resolveLanguage('en', 'vi-VN')).toBe('en');
  });

  it('follows the phone for system, defaulting to English', () => {
    expect(resolveLanguage('system', 'vi-VN')).toBe('vi');
    expect(resolveLanguage('system', 'en-GB')).toBe('en');
    expect(resolveLanguage('system', 'ja-JP')).toBe('en');
    expect(resolveLanguage('system', null)).toBe('en');
  });
});

describe('intlLocaleFor', () => {
  it('leaves the phone own locale alone for system, and pins an explicit choice', () => {
    expect(intlLocaleFor('system')).toBeUndefined();
    expect(intlLocaleFor('vi')).toBe('vi-VN');
    expect(intlLocaleFor('en')).toBe('en-US');
  });
});
