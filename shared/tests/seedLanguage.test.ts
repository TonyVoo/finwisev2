import { describe, expect, it } from 'vitest';
import {
  CategoryName,
  DEFAULT_CATEGORIES,
  SEED_LANGUAGES,
  SignupRequest,
  UNCATEGORIZED_NAME,
  defaultCategories,
} from '../src/index.js';

/**
 * The categories an account is seeded with are named in the language the app was showing at
 * signup. Everything about a seeded category except its name is the same in every language:
 * the order, the colours, and which one is the undeletable default.
 */

describe('defaultCategories', () => {
  it('is the English set unless another language is named', () => {
    expect(defaultCategories()).toEqual(DEFAULT_CATEGORIES);
    expect(defaultCategories('en')).toEqual(DEFAULT_CATEGORIES);
    expect(defaultCategories('en')[0]!.name).toBe(UNCATEGORIZED_NAME);
  });

  it('names the Vietnamese set in Vietnamese', () => {
    expect(defaultCategories('vi').map((category) => category.name)).toEqual([
      'Chưa phân loại',
      'Tạp hóa',
      'Di chuyển',
      'Ăn ngoài',
      'Hóa đơn',
      'Sức khỏe',
    ]);
  });

  it.each(SEED_LANGUAGES)('keeps order, colours and the default flag in %s', (language) => {
    const seeded = defaultCategories(language);
    expect(seeded).toHaveLength(DEFAULT_CATEGORIES.length);
    seeded.forEach((category, index) => {
      expect(category.color).toBe(DEFAULT_CATEGORIES[index]!.color);
      expect(category.isDefault).toBe(DEFAULT_CATEGORIES[index]!.isDefault);
    });
    expect(seeded.filter((category) => category.isDefault)).toHaveLength(1);
    expect(seeded[0]!.isDefault).toBe(true);
  });

  it.each(SEED_LANGUAGES)('has %s names a category can actually have', (language) => {
    const names = defaultCategories(language).map((category) => category.name);
    for (const name of names) expect(CategoryName.safeParse(name).success).toBe(true);
    // Names are unique per account, case-insensitively, so a clash would fail every signup.
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
  });
});

describe('the signup language', () => {
  const base = { email: 'ada@example.com', password: 'correct horse battery' };

  it('is optional', () => {
    expect(SignupRequest.safeParse(base).success).toBe(true);
  });

  it.each(SEED_LANGUAGES)('accepts %s', (language) => {
    expect(SignupRequest.safeParse({ ...base, language }).success).toBe(true);
  });

  it('refuses a language the server has no names for', () => {
    expect(SignupRequest.safeParse({ ...base, language: 'fr' }).success).toBe(false);
    expect(SignupRequest.safeParse({ ...base, language: 'VI' }).success).toBe(false);
  });
});
