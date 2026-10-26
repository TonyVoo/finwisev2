import {
  DEFAULT_CATEGORIES,
  type Category as WireCategory,
  type CategoryCreateRequest,
  type CategoryUpdateRequest,
} from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { toWireCategory } from '../db/mappers.ts';
import { nextRevision, nextRevisionBlock } from '../db/revision.ts';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import type { Category as CategoryRow } from '../db/generated/client.ts';

/**
 * Category CRUD.
 *
 * The three rules that make this file more than a thin wrapper over Prisma:
 *
 *  * **Names are unique per user among live rows, case-insensitively.** Enforced by a
 *    partial functional index in the first migration; the check here exists to produce
 *    the contract's message, and the index is what makes it true under concurrency.
 *  * **Deleting a category reassigns its expenses to the `isDefault` one**, in the same
 *    transaction, and never cascade-deletes them. Losing spend history to a category
 *    cleanup would be a data-loss bug, not a cosmetic one.
 *  * **The default category cannot be deleted**, because it is the reassignment target.
 *    It *can* be renamed and recoloured, and the target is resolved by the `isDefault`
 *    flag — never by matching the string "Uncategorized", which a rename would break.
 *
 * Every query is scoped by the `userId` from the access token, and a row belonging to
 * another user is reported as `404`, indistinguishable from one that does not exist.
 */

/** Colours the server cycles through when the client omits one. */
const ASSIGNABLE_COLORS = DEFAULT_CATEGORIES.filter((c) => !c.isDefault).map((c) => c.color);

/**
 * Pick a colour for a category the client did not colour itself.
 *
 * Cycles the accessible palette by how many categories the user already has, so a user
 * creating several in a row gets distinguishable swatches rather than the same one
 * repeated. Not unique — uniqueness of colour is not a contract promise, and failing a
 * create because the palette ran out would be worse than a repeat.
 */
function assignColor(existingCount: number): string {
  const color = ASSIGNABLE_COLORS[existingCount % ASSIGNABLE_COLORS.length];
  if (color === undefined) throw new Error('ASSIGNABLE_COLORS is empty');
  return color;
}

/**
 * The colour to give a category this user is creating without one.
 *
 * Shared with the sync push path so a category created offline gets a swatch from the
 * same cycle as one created online — two code paths picking colours by different rules
 * would show the user a different palette depending on whether they had signal.
 */
export async function assignCategoryColor(db: Db, userId: string): Promise<string> {
  return assignColor(await db.category.count({ where: { userId, deletedAt: null } }));
}

/**
 * Sort as the contract promises: by `name`, case-insensitively, ties broken by `id`.
 *
 * Done here rather than in `ORDER BY` because Postgres orders text by the database's
 * collation, which in a `C`-locale cluster puts every capital letter before every
 * lowercase one — so `Uncategorized` would sort before `bills` on one deployment and
 * after it on another. The category set is small by design (the endpoint is not
 * paginated), so sorting in process is cheap and deterministic everywhere.
 */
function byName(rows: CategoryRow[]): CategoryRow[] {
  return [...rows].sort((a, b) => {
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export async function listCategories(
  db: Db,
  userId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<WireCategory[]> {
  const rows = await db.category.findMany({
    where: { userId, ...(options.includeDeleted ? {} : { deletedAt: null }) },
  });
  return byName(rows).map(toWireCategory);
}

/**
 * Find the user's live `isDefault` category — the target a delete reassigns to.
 *
 * Resolved by the flag, never by the name: `Uncategorized` can be renamed, and a
 * name-matching lookup would silently stop finding it the moment a user did
 * (`CAT-08`). A unique partial index guarantees there is at most one.
 */
async function requireDefaultCategory(db: Db, userId: string): Promise<CategoryRow> {
  const row = await db.category.findFirst({ where: { userId, isDefault: true, deletedAt: null } });
  if (!row) {
    // Seeded in the signup transaction and undeletable by construction (API check plus a
    // CHECK constraint), so this is a broken invariant rather than a user error.
    throw new Error(`user ${userId} has no live default category`);
  }
  return row;
}

/**
 * Is this name already taken by another live category of the user?
 *
 * `excludeId` is the row being renamed, so renaming a category to the name it already
 * has is not a self-conflict (`CAT-04`).
 */
async function nameIsTaken(
  db: Db,
  userId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  const clash = await db.category.findFirst({
    where: {
      userId,
      deletedAt: null,
      // The schema's unique index is on `lower(name)`; this must match it, or the
      // pre-check passes and the insert raises a constraint violation instead.
      name: { equals: name, mode: 'insensitive' },
      ...(excludeId === undefined ? {} : { NOT: { id: excludeId } }),
    },
    select: { id: true },
  });
  return clash !== null;
}

/**
 * `POST /v1/categories`.
 *
 * Accepts a client-minted UUIDv7 so a row created offline keeps its identity, and is
 * **idempotent on a re-post of the same id**: the stored row comes back unchanged, with
 * no new `revision`. It is deliberately not an *upsert* — the field values in a re-post
 * are ignored rather than applied, because a retried create and an edit are different
 * intentions and only `POST /v1/sync` carries the `updatedAt` needed to order the second
 * one. A client whose response was dropped can therefore retry safely, and one that
 * wants to change a field uses `PATCH`.
 */
export async function createCategory(
  db: Db,
  userId: string,
  input: CategoryCreateRequest,
): Promise<WireCategory> {
  const id = input.id ?? uuidv7();
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const replay = await findForIdempotentCreate(tx, userId, id);
      if (replay) return toWireCategory(replay);

      if (await nameIsTaken(tx, userId, input.name)) {
        throw problems.categoryNameTaken(input.name);
      }

      const color =
        input.color ?? assignColor(await tx.category.count({ where: { userId, deletedAt: null } }));

      const revision = await nextRevision(tx, userId);
      const created = await tx.category.create({
        data: {
          id,
          userId,
          name: input.name,
          color,
          // `isDefault` is not settable through any write path: the default is seeded at
          // signup and there is exactly one. See GAP 1 in `docs/qa/TEST_PLAN.md`.
          isDefault: false,
          monthlyBudgetMinor: input.monthlyBudgetMinor ?? null,
          // Set explicitly rather than left to the column default, so that a freshly
          // created row reports `createdAt === updatedAt` to the millisecond.
          createdAt: now,
          updatedAt: now,
          revision,
        },
      });
      return toWireCategory(created);
    });
  } catch (error) {
    // The index is the real guard: two concurrent creates of the same name both pass the
    // check above, and one of them has to lose here rather than write a duplicate.
    if (isUniqueViolation(error, 'lower_name')) throw problems.categoryNameTaken(input.name);
    throw error;
  }
}

/**
 * Resolve a `POST` with a client-supplied id that is already in use.
 *
 * Returns the stored row when it belongs to the caller, so the create is an idempotent
 * replay. Raises when it belongs to someone else: ids are the global primary key, so the
 * server cannot honour the create, and it must not answer with another user's row. The
 * caller learns only that the id it minted is unusable — a UUIDv7 is not guessable, so
 * that is not a probe worth defending further, and the alternative is a 500 from a
 * primary-key violation.
 */
async function findForIdempotentCreate(
  db: Db,
  userId: string,
  id: string,
): Promise<CategoryRow | null> {
  const existing = await db.category.findUnique({ where: { id } });
  if (!existing) return null;
  if (existing.userId !== userId) {
    throw problems.validation('The supplied id is already in use.', {
      issues: [{ path: 'id', message: 'already in use' }],
    });
  }
  return existing;
}

/**
 * Assert that `categoryId` names a live category of this user, and hold it that way for
 * the rest of the transaction. Raises `422 unknown_category` otherwise.
 *
 * `FOR KEY SHARE` is the same lock strength the foreign key itself takes when an expense
 * row is inserted, so two expense writes against one category do not block each other.
 * What it *does* conflict with is the `FOR UPDATE` that `deleteCategory` takes. That is
 * the point: a create racing a delete of its category either gets here first and is
 * reassigned by the delete, or blocks here and — because a locking read under READ
 * COMMITTED re-evaluates its `WHERE` against the row it finally locks — sees the fresh
 * tombstone and fails. Neither order can leave an expense pointing at a dead category.
 *
 * It also covers the three ways a `categoryId` can be wrong (no such id, another user's,
 * tombstoned) with one indistinguishable error, so the field cannot be used to probe.
 */
export async function requireLiveCategoryForWrite(
  db: Db,
  userId: string,
  categoryId: string,
): Promise<void> {
  return requireOwnCategoryForWrite(db, userId, categoryId, { requireLive: true });
}

/**
 * The general form of {@link requireLiveCategoryForWrite}, for the one caller that must
 * not require a *live* category: a `POST /v1/sync` item that tombstones an expense.
 *
 * Deleting an expense whose category the user already cleaned up has to succeed. The
 * row's `category_id` still points at the tombstoned category — a category delete
 * reassigns only *live* expenses — so insisting on a live category would refuse the
 * delete and leave the client retrying it forever. `requireLive: false` still demands
 * that the category exist and belong to the caller, which is what the foreign key needs
 * and what keeps another user's category id from being usable here.
 */
export async function requireOwnCategoryForWrite(
  db: Db,
  userId: string,
  categoryId: string,
  options: { readonly requireLive: boolean },
): Promise<void> {
  const rows = options.requireLive
    ? await db.$queryRaw<{ id: string }[]>`
        SELECT "id"
          FROM "categories"
         WHERE "id" = ${categoryId}::uuid
           AND "user_id" = ${userId}::uuid
           AND "deleted_at" IS NULL
           FOR KEY SHARE
      `
    : await db.$queryRaw<{ id: string }[]>`
        SELECT "id"
          FROM "categories"
         WHERE "id" = ${categoryId}::uuid
           AND "user_id" = ${userId}::uuid
           FOR KEY SHARE
      `;
  if (rows.length === 0) throw problems.unknownCategory();
}

/** Load a live category of this user, or raise the contract's `404`. */
async function requireOwnLiveCategory(db: Db, userId: string, id: string): Promise<CategoryRow> {
  const row = await db.category.findFirst({ where: { id, userId, deletedAt: null } });
  if (!row) {
    // One message for "no such id", "another user's id" and "tombstoned", because the
    // three have to be indistinguishable — anything else probes for existence.
    throw problems.notFound('No such category.');
  }
  return row;
}

/** `PATCH /v1/categories/:id`. Partial; renames and recolours, including the default. */
export async function updateCategory(
  db: Db,
  userId: string,
  id: string,
  patch: CategoryUpdateRequest,
): Promise<WireCategory> {
  const now = new Date();

  try {
    return await db.$transaction(async (tx) => {
      const existing = await requireOwnLiveCategory(tx, userId, id);

      if (patch.name !== undefined && (await nameIsTaken(tx, userId, patch.name, existing.id))) {
        throw problems.categoryNameTaken(patch.name);
      }

      const revision = await nextRevision(tx, userId);
      const updated = await tx.category.update({
        where: { id: existing.id },
        data: {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.color === undefined ? {} : { color: patch.color }),
          // `null` clears the budget; absent leaves it alone.
          ...(patch.monthlyBudgetMinor === undefined
            ? {}
            : { monthlyBudgetMinor: patch.monthlyBudgetMinor }),
          updatedAt: now,
          revision,
        },
      });
      return toWireCategory(updated);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'lower_name') && patch.name !== undefined) {
      throw problems.categoryNameTaken(patch.name);
    }
    throw error;
  }
}

/**
 * `DELETE /v1/categories/:id` — soft-delete, and reassign the expenses.
 *
 * One transaction does three things: tombstones the category, moves every live expense
 * that referenced it to the user's default category, and stamps all of them with fresh
 * `updatedAt`/`revision` values so they arrive on the next `GET /v1/sync`. A client that
 * only tombstoned the category locally would otherwise be left with expenses pointing at
 * a deleted category — the state the single transaction exists to prevent.
 *
 * The row is locked `FOR UPDATE` first, which is what makes the expense count reliable —
 * see {@link requireLiveCategoryForWrite} for the other half of that interlock. Without
 * it, an expense inserted between the count and the update would survive pointing at a
 * dead category.
 */
export async function deleteCategory(db: Db, userId: string, id: string): Promise<WireCategory> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const locked = await lockOwnCategory(tx, userId, id);

    if (locked.isDefault) {
      // The reassignment target has to exist, so this one is undeletable. A CHECK
      // constraint in the migration is the backstop if a code path ever forgets.
      throw problems.categoryNotDeletable();
    }

    if (locked.deletedAt !== null) {
      // Idempotent: return the existing tombstone without advancing `updatedAt` or
      // `revision`, so a retried delete does not push the row onto another sync page.
      const row = await tx.category.findUniqueOrThrow({ where: { id: locked.id } });
      return toWireCategory(row);
    }

    const fallback = await requireDefaultCategory(tx, userId);
    const affected = await tx.expense.count({
      where: { userId, categoryId: locked.id, deletedAt: null },
    });

    // One revision for the category tombstone, then one per reassigned expense. Drawn as
    // a single block so the whole delete costs one round trip to the counter rather than
    // one per expense, and taken inside this transaction so a rollback returns them.
    const revisions = await nextRevisionBlock(tx, userId, affected + 1);
    const [categoryRevision] = revisions;
    if (categoryRevision === undefined) throw new Error('empty revision block');

    const tombstoned = await tx.category.update({
      where: { id: locked.id },
      data: { deletedAt: now, updatedAt: now, revision: categoryRevision },
    });

    if (affected > 0) {
      await reassignExpenses(tx, {
        userId,
        fromCategoryId: locked.id,
        toCategoryId: fallback.id,
        now,
        // The category took the first revision of the block; the expenses take the rest,
        // which keeps the tombstone ahead of the rows that depend on it when a client
        // applies a pull in `revision` order.
        firstRevision: categoryRevision + 1,
        expected: affected,
      });
    }

    logger.info('category deleted', { userId, categoryId: locked.id, reassigned: affected });
    return toWireCategory(tombstoned);
  });
}

/** The columns `deleteCategory` branches on, before it reads the full row back. */
interface LockedCategory {
  readonly id: string;
  readonly isDefault: boolean;
  readonly deletedAt: Date | null;
}

/**
 * Lock the user's category row for the duration of the transaction.
 *
 * `FOR UPDATE` rather than a plain read: it conflicts with the `FOR KEY SHARE` that an
 * expense insert takes on its category, which is what serialises a delete against a
 * concurrent create. Tombstoned rows are included, because a re-delete has to be able to
 * see the existing tombstone and return it.
 */
async function lockOwnCategory(db: Db, userId: string, id: string): Promise<LockedCategory> {
  const rows = await db.$queryRaw<{ id: string; is_default: boolean; deleted_at: Date | null }[]>`
    SELECT "id", "is_default", "deleted_at"
      FROM "categories"
     WHERE "id" = ${id}::uuid AND "user_id" = ${userId}::uuid
       FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw problems.notFound('No such category.');
  return { id: row.id, isDefault: row.is_default, deletedAt: row.deleted_at };
}

/**
 * Move every live expense of one category to another, stamping consecutive revisions.
 *
 * A single statement rather than a loop: the revisions come from a pre-allocated block
 * and `row_number()` hands them out in a deterministic order, so a category with two
 * hundred expenses is one UPDATE instead of two hundred.
 */
async function reassignExpenses(
  db: Db,
  args: {
    userId: string;
    fromCategoryId: string;
    toCategoryId: string;
    now: Date;
    firstRevision: number;
    expected: number;
  },
): Promise<void> {
  const base = args.firstRevision - 1;
  const updated = await db.$executeRaw`
    WITH "ordered" AS (
      SELECT "id", row_number() OVER (ORDER BY "id") AS "rn"
        FROM "expenses"
       WHERE "user_id" = ${args.userId}::uuid
         AND "category_id" = ${args.fromCategoryId}::uuid
         AND "deleted_at" IS NULL
    )
    UPDATE "expenses" AS "e"
       SET "category_id" = ${args.toCategoryId}::uuid,
           "updated_at" = ${args.now},
           "revision" = (${base}::int + "o"."rn")::int
      FROM "ordered" AS "o"
     WHERE "e"."id" = "o"."id"
  `;

  if (updated !== args.expected) {
    // The count was taken in this transaction while holding the category's row lock, so
    // a mismatch means the lock did not do its job and the block of revisions no longer
    // lines up with the rows being stamped. Rolling back is the only safe answer: a row
    // left with a stale revision is a row no syncing client would ever see again.
    throw new Error(
      `category delete reassigned ${updated} expenses but allocated revisions for ${args.expected}`,
    );
  }
}
