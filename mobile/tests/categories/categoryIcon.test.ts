import { CATEGORY_ICON_FALLBACK, categoryIcon } from '@/categories/categoryIcon';

/**
 * A category's icon is picked from its name, because the name is the only thing the person
 * chose: nothing is stored, so renaming a category re-icons it and old data needs no migration.
 * Names are matched in English and Vietnamese, ignoring case and diacritics.
 */
describe('categoryIcon', () => {
  it.each([
    ['Groceries', 'shopping-cart'],
    ['Tạp hóa', 'shopping-cart'],
    ['Transport', 'navigation'],
    ['Di chuyển', 'navigation'],
    ['Eating out', 'coffee'],
    ['Ăn ngoài', 'coffee'],
    ['Bills', 'file-text'],
    ['Hóa đơn', 'file-text'],
    ['Health', 'heart'],
    ['Sức khỏe', 'heart'],
  ])('gives the seeded category %s its own icon', (name, icon) => {
    expect(categoryIcon(name)).toBe(icon);
  });

  it('ignores case and surrounding space', () => {
    expect(categoryIcon('  GROCERIES ')).toBe('shopping-cart');
  });

  it('matches a keyword inside a longer name', () => {
    expect(categoryIcon('Weekly groceries run')).toBe('shopping-cart');
  });

  it('falls back to a generic tag for a name it does not know', () => {
    expect(categoryIcon('Zebra stuff')).toBe(CATEGORY_ICON_FALLBACK);
    expect(categoryIcon('')).toBe(CATEGORY_ICON_FALLBACK);
  });

  it('uses a distinct icon for the undeletable default', () => {
    expect(categoryIcon('Uncategorized')).toBe('help-circle');
    expect(categoryIcon('Chưa phân loại')).toBe('help-circle');
  });
});
