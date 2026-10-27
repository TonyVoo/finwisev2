import {
  DEFAULT_CATEGORIES,
  SEED_LANGUAGES,
  defaultCategories,
  type SeedLanguage,
} from '@expense-tracker/shared';

/**
 * Which categories may be renamed into another language, and to what.
 *
 * Category names are the person's own data, so the rule is conservative: a category is a
 * candidate only while it is still *exactly* one of the seeded defaults - one of the seeded
 * names **and** that name's seeded colour. A category the person renamed, recoloured or made
 * themselves is never touched, even when it happens to share a name with a default.
 *
 * Pure: it plans, and `renameCategories` (`db/mutations.ts`) does the writing.
 */

export interface RenameStep {
  readonly id: string;
  /** The name as it is now, untrimmed. */
  readonly from: string;
  readonly to: string;
}

interface Candidate {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDefault: boolean;
}

const normal = (name: string): string => name.trim().toLowerCase();

/** The default's position in the seeded set if `category` is still an untouched one, else -1. */
function seededIndex(category: Candidate, target: SeedLanguage): number {
  for (const language of SEED_LANGUAGES) {
    if (language === target) continue;
    const seeded = defaultCategories(language);
    const index = seeded.findIndex((entry) => normal(entry.name) === normal(category.name));
    if (index === -1) continue;
    const original = DEFAULT_CATEGORIES[index];
    if (original === undefined) continue;
    // Same colour, and the undeletable default must still be the default (and only it).
    if (category.color.toLowerCase() !== original.color.toLowerCase()) continue;
    if (category.isDefault !== original.isDefault) continue;
    return index;
  }
  return -1;
}

export function planDefaultRenames(
  categories: readonly Candidate[],
  target: SeedLanguage,
): readonly RenameStep[] {
  const targetNames = defaultCategories(target);
  const inUse = new Set(categories.map((category) => normal(category.name)));

  const steps: { index: number; step: RenameStep }[] = [];
  for (const category of categories) {
    const index = seededIndex(category, target);
    const to = targetNames[index]?.name;
    if (index === -1 || to === undefined) continue;
    // Already has the target name (case-insensitively): nothing to change.
    if (normal(category.name) === normal(to)) continue;
    // Another category already uses that name; names are unique per account.
    if (inUse.has(normal(to))) continue;
    steps.push({ index, step: { id: category.id, from: category.name, to } });
  }

  // In the order the defaults are seeded, which is the order a person knows them in.
  return steps.sort((a, b) => a.index - b.index).map((entry) => entry.step);
}
