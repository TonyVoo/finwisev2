import type { CategoryWithCount } from '@/db/queries';
import { categoryRowLabel, expenseCountLabel } from '@/categories/categoryModel';

/**
 * What a category row says out loud: `docs/design/07-categories.md` §5 rules 1 and 2.
 *
 * Three plural forms and two conditional suffixes, every one of which is a sentence a
 * screen-reader user hears and nobody will spot on screen.
 */

function category(overrides: Partial<CategoryWithCount> = {}): CategoryWithCount {
  return {
    id: 'c1',
    name: 'Groceries',
    color: '#2F8044',
    isDefault: false,
    monthlyBudgetMinor: null,
    pending: false,
    expenseCount: 23,
    ...overrides,
  };
}

describe('expenseCountLabel', () => {
  it('has an explicit form for each count', () => {
    // Deck §0: "Every string with a count has an explicit singular form — there is no
    // `(s)` anywhere."
    expect(expenseCountLabel(23)).toBe('23 expenses');
    expect(expenseCountLabel(2)).toBe('2 expenses');
    expect(expenseCountLabel(1)).toBe('1 expense');
  });

  it('speaks zero as words, not as the digit', () => {
    // The *column* renders `0` so it stays scannable (§1 rule 2), but a bare "0" read
    // aloud after a category name is a stumble, so the spoken form is words.
    expect(expenseCountLabel(0)).toBe('No expenses');
  });
});

describe('categoryRowLabel', () => {
  it('composes the name and the count', () => {
    expect(categoryRowLabel(category())).toBe('Groceries, 23 expenses');
  });

  it('carries the singular and the zero through', () => {
    expect(categoryRowLabel(category({ expenseCount: 1 }))).toBe('Groceries, 1 expense');
    expect(categoryRowLabel(category({ expenseCount: 0 }))).toBe('Groceries, No expenses');
  });

  it('says when the row has not synced', () => {
    expect(categoryRowLabel(category({ pending: true }))).toBe(
      'Groceries, 23 expenses, not synced yet',
    );
  });

  it('warns that the default category cannot be deleted', () => {
    // §5 rule 2: the point is that a screen-reader user "learns the constraint before
    // trying", rather than being refused after reaching for the action.
    expect(
      categoryRowLabel(category({ name: 'Uncategorized', isDefault: true, expenseCount: 2 })),
    ).toBe('Uncategorized, 2 expenses, cannot be deleted');
  });

  it('states both suffixes in order when both apply', () => {
    const row = category({ name: 'Later', isDefault: true, pending: true, expenseCount: 0 });

    expect(categoryRowLabel(row)).toBe('Later, No expenses, not synced yet, cannot be deleted');
  });

  it('names the default row by its own name, whatever it was renamed to', () => {
    // The `isDefault` category can be renamed, and nothing depends on its literal name
    // because it is identified by its flag (§3 rule 2).
    expect(
      categoryRowLabel(category({ name: 'Later', isDefault: true, expenseCount: 5 })),
    ).toContain('Later, 5 expenses');
  });
});
