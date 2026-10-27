import { DEFAULT_CATEGORIES, defaultCategories } from '@expense-tracker/shared';
import { planDefaultRenames } from '@/categories/renameDefaults';

/**
 * Which categories may be renamed into another language, and to what.
 *
 * Category names are the person's own data, so the rule is conservative: only a category that
 * is still exactly one of the seeded defaults - the English name *and* its seeded colour - is
 * a candidate. Anything the person renamed, recoloured or made themselves is never touched.
 */

const EN = defaultCategories('en');

function row(index: number, overrides: Partial<{ id: string; name: string; color: string }> = {}) {
  const seed = EN[index]!;
  return {
    id: overrides.id ?? `c${index}`,
    name: overrides.name ?? seed.name,
    color: overrides.color ?? seed.color,
    isDefault: seed.isDefault,
  };
}

const ALL = EN.map((_c, index) => row(index));

describe('planDefaultRenames', () => {
  it('renames every untouched English default to its Vietnamese name, in order', () => {
    expect(planDefaultRenames(ALL, 'vi')).toEqual([
      { id: 'c0', from: 'Uncategorized', to: 'Chưa phân loại' },
      { id: 'c1', from: 'Groceries', to: 'Tạp hóa' },
      { id: 'c2', from: 'Transport', to: 'Di chuyển' },
      { id: 'c3', from: 'Eating out', to: 'Ăn ngoài' },
      { id: 'c4', from: 'Bills', to: 'Hóa đơn' },
      { id: 'c5', from: 'Health', to: 'Sức khỏe' },
    ]);
  });

  it('has nothing to do when the target is the language they are already in', () => {
    expect(planDefaultRenames(ALL, 'en')).toEqual([]);
  });

  it('leaves a category the person renamed alone', () => {
    const plan = planDefaultRenames([row(1, { name: 'Supermarket' }), row(2)], 'vi');
    expect(plan.map((step) => step.id)).toEqual(['c2']);
  });

  it('leaves a category the person recoloured alone, even with the seeded name', () => {
    const plan = planDefaultRenames([row(1, { color: '#000000' }), row(2)], 'vi');
    expect(plan.map((step) => step.id)).toEqual(['c2']);
  });

  it('leaves a category of their own alone, even if it has a default-looking name', () => {
    // Same name, but not the seeded colour: something the person made.
    const mine = { id: 'mine', name: 'Groceries', color: '#123456', isDefault: false };
    expect(planDefaultRenames([mine], 'vi')).toEqual([]);
  });

  it('matches the name without caring about case or surrounding spaces', () => {
    const plan = planDefaultRenames([row(3, { name: ' eating OUT ' })], 'vi');
    expect(plan).toEqual([{ id: 'c3', from: ' eating OUT ', to: 'Ăn ngoài' }]);
  });

  it('requires the undeletable default to still be the default', () => {
    const notDefault = { ...row(0), isDefault: false };
    expect(planDefaultRenames([notDefault], 'vi')).toEqual([]);
  });

  it('skips a rename that would collide with a name already in use', () => {
    const taken = { id: 'x', name: 'Tạp hóa', color: '#123456', isDefault: false };
    const plan = planDefaultRenames([row(1), row(2), taken], 'vi');
    expect(plan.map((step) => step.id)).toEqual(['c2']);
  });

  it('treats a collision case-insensitively', () => {
    const taken = { id: 'x', name: 'TẠP HÓA', color: '#123456', isDefault: false };
    expect(planDefaultRenames([row(1), taken], 'vi')).toEqual([]);
  });

  it('is empty once everything has been renamed, so it is safe to run twice', () => {
    const renamed = planDefaultRenames(ALL, 'vi').map((step, index) => ({
      ...ALL[index]!,
      name: step.to,
    }));
    expect(planDefaultRenames(renamed, 'vi')).toEqual([]);
  });

  it('goes the other way too, from Vietnamese back to English', () => {
    const vi = defaultCategories('vi').map((c, index) => ({
      id: `v${index}`,
      name: c.name,
      color: c.color,
      isDefault: c.isDefault,
    }));
    expect(planDefaultRenames(vi, 'en').map((step) => step.to)).toEqual(
      DEFAULT_CATEGORIES.map((c) => c.name),
    );
  });

  it('returns nothing for no categories', () => {
    expect(planDefaultRenames([], 'vi')).toEqual([]);
  });
});
