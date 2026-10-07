import { z } from 'zod';
import { LIMITS, Uuid } from './primitives.js';
import { SYNCABLE_SHAPE } from './syncable.js';

/**
 * Categories are user-owned and seeded on signup. Deleting one **reassigns** its
 * expenses to the user's `Uncategorized` default rather than cascading — losing spend
 * history to a category cleanup would be a data-loss bug.
 */

export const CategoryName = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.CATEGORY_NAME_MAX)
  .describe(
    'Display name, 1-64 characters after trimming. Unique per user among live (non-deleted) categories, compared case-insensitively.',
  );

export const CategoryColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB hex colour')
  .describe('Chart/list swatch as a #RRGGBB hex colour. The server assigns one when omitted.');

/** A category row as the server reports it. */
export const Category = z.strictObject({
  ...SYNCABLE_SHAPE,
  name: CategoryName,
  color: CategoryColor,
  isDefault: z
    .boolean()
    .describe(
      'True for the seeded `Uncategorized` category, which always exists and cannot be deleted. Deleting any other category reassigns its expenses here.',
    ),
});

export const CategoryCreateRequest = z.strictObject({
  id: Uuid.optional().describe(
    'Optional client-minted UUIDv7. Supply it so a row created offline keeps its identity; omit it and the server mints one.',
  ),
  name: CategoryName,
  color: CategoryColor.optional(),
});

export const CategoryUpdateRequest = z
  .strictObject({
    name: CategoryName.optional(),
    color: CategoryColor.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'at least one field must be present' });

export const CategoryListQuery = z.strictObject({
  includeDeleted: z
    .stringbool()
    .optional()
    .describe('Include tombstoned categories. Defaults to false. Mainly for debugging and tests.'),
});

export const CategoryListResponse = z.strictObject({
  data: z.array(Category).describe('All live categories of the user, ordered by `name`.'),
});

export const CategoryResponse = z.strictObject({
  data: Category,
});

export type CategoryName = z.infer<typeof CategoryName>;
export type CategoryColor = z.infer<typeof CategoryColor>;
export type Category = z.infer<typeof Category>;
export type CategoryCreateRequest = z.infer<typeof CategoryCreateRequest>;
export type CategoryUpdateRequest = z.infer<typeof CategoryUpdateRequest>;
export type CategoryListQuery = z.infer<typeof CategoryListQuery>;
export type CategoryListResponse = z.infer<typeof CategoryListResponse>;
export type CategoryResponse = z.infer<typeof CategoryResponse>;

/** Name of the undeletable default category every user is seeded with. */
export const UNCATEGORIZED_NAME = 'Uncategorized';

/**
 * Categories seeded on signup. The first is the undeletable default.
 *
 * The colours are the accessible set from `docs/design/00-foundations.md` §1.3 — every one
 * clears 4.5:1 on white, because a category colour is used as a chart legend label and as a
 * swatch beside small text. They replaced the original Tailwind 500-weights (2.28:1-3.96:1,
 * three of them below even 3:1) on board approval, 2026-10-06. `shared/tests/tokens.test.ts`
 * measures them, so a colour that stops being accessible fails the build.
 */
export const DEFAULT_CATEGORIES = [
  { name: UNCATEGORIZED_NAME, color: '#6B7280', isDefault: true },
  { name: 'Groceries', color: '#2F8044', isDefault: false },
  { name: 'Transport', color: '#2F6FD0', isDefault: false },
  { name: 'Eating out', color: '#A85C12', isDefault: false },
  { name: 'Bills', color: '#8E4EC6', isDefault: false },
  { name: 'Health', color: '#C73B3B', isDefault: false },
] as const satisfies ReadonlyArray<{ name: string; color: string; isDefault: boolean }>;
