import { randomBytes } from 'node:crypto';
import { defaultCategories } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { hashPassword } from '../auth/password.ts';
import type { Db } from '../db/client.ts';
import { nextRevisionBlock } from '../db/revision.ts';

/**
 * The household's book: where its rows live (`docs/design/10-households.md`).
 *
 * A book is an account-like row that no one can sign in to, so every synced table stays scoped
 * by one `user_id` and the household can change owner without a row moving. These are the few
 * operations that do move rows - when a household is created (the creator's books go into the
 * book) and when it is deleted (the book goes to the owner) - plus the small safeguard that a
 * person returning to their own books finds default categories there.
 *
 * Everything takes the caller's transaction: a move that half-happened would leave rows in two
 * scopes at once.
 */

/** Tables whose rows are scoped by `user_id` and move with a book, besides the counter. */
const BOOK_TABLES = [
  'categories',
  'expenses',
  'recurring_rules',
  'goals',
  'sync_mutations',
  'expense_receipts',
] as const;

/**
 * A password hash for something no one signs in to: a random value that is hashed and then
 * forgotten. Hashed *before* a transaction opens, as everywhere else, because argon2 is slow.
 */
export async function unusablePasswordHash(): Promise<string> {
  return await hashPassword(randomBytes(32).toString('hex'));
}

/**
 * Create a book: a user row with no way in, and its revision counter.
 *
 * The email is on a TLD that cannot exist, so there is no inbox to reach either.
 */
export async function createBook(tx: Db, currency: string, passwordHash: string): Promise<string> {
  const id = uuidv7();
  await tx.user.create({
    data: { id, email: `book-${id}@households.invalid`, passwordHash, currency },
  });
  await tx.revisionCounter.create({ data: { userId: id } });
  return id;
}

/**
 * Move every row of `from` into the empty book `to`, keeping revisions, and continue `to`'s
 * counter from where `from`'s was. A device that already holds these rows then sees the same
 * revisions in the new scope's stream (it switches scope by resyncing anyway).
 */
export async function moveBooks(tx: Db, from: string, to: string): Promise<void> {
  for (const table of BOOK_TABLES) {
    await tx.$executeRawUnsafe(
      `UPDATE "${table}" SET "user_id" = $1::uuid WHERE "user_id" = $2::uuid`,
      to,
      from,
    );
  }
  const counter = await tx.revisionCounter.findUniqueOrThrow({ where: { userId: from } });
  await tx.revisionCounter.update({
    where: { userId: to },
    data: {
      lastRevision: counter.lastRevision,
      prunedThroughRevision: counter.prunedThroughRevision,
    },
  });
}

/**
 * Merge every row of the book `from` into the account `into`, then leave `from` empty.
 *
 * `into` may already have books of its own (a member who was handed the household and now
 * deletes it), so nothing is assumed about them:
 *
 *  * **Categories are matched by name**, case-insensitively, as the live-name index requires. A
 *    household category whose name `into` already has is folded into it (its expenses and
 *    recurring rules are pointed at the existing one); the rest are added. The household's
 *    default category folds into `into`'s default, or becomes it when `into` has none.
 *  * **Every moved row gets a fresh revision** from `into`'s counter, so revisions stay unique
 *    and ascending in the stream `into`'s devices will resync from.
 *  * The idempotency ledger is dropped: it only mattered to devices of the old scope.
 */
export async function mergeBooks(tx: Db, from: string, into: string): Promise<void> {
  const theirs = await tx.category.findMany({
    where: { userId: from },
    orderBy: { revision: 'asc' },
  });
  const mine = await tx.category.findMany({ where: { userId: into, deletedAt: null } });

  const byName = new Map(mine.map((category) => [category.name.toLowerCase(), category.id]));
  let defaultId: string | null = mine.find((category) => category.isDefault)?.id ?? null;

  const remap = new Map<string, string>();
  const keep: string[] = [];
  const drop: string[] = [];
  let promoteToDefault: string | null = null;

  // Live categories first, so a tombstone can fall back to a default that may be one of them.
  for (const category of theirs.filter((c) => c.deletedAt === null)) {
    const sameName = byName.get(category.name.toLowerCase());
    if (category.isDefault) {
      if (defaultId !== null) {
        remap.set(category.id, defaultId);
        drop.push(category.id);
      } else {
        defaultId = category.id;
        promoteToDefault = category.id;
        keep.push(category.id);
        byName.set(category.name.toLowerCase(), category.id);
      }
    } else if (sameName !== undefined) {
      remap.set(category.id, sameName);
      drop.push(category.id);
    } else {
      keep.push(category.id);
      byName.set(category.name.toLowerCase(), category.id);
    }
  }
  for (const category of theirs.filter((c) => c.deletedAt !== null)) {
    // A deleted category has nothing live pointing at it, but a deleted expense may.
    if (defaultId !== null) remap.set(category.id, defaultId);
    drop.push(category.id);
  }

  for (const [oldId, newId] of remap) {
    await tx.$executeRaw`UPDATE "expenses" SET "category_id" = ${newId}::uuid WHERE "user_id" = ${from}::uuid AND "category_id" = ${oldId}::uuid`;
    await tx.$executeRaw`UPDATE "recurring_rules" SET "category_id" = ${newId}::uuid WHERE "user_id" = ${from}::uuid AND "category_id" = ${oldId}::uuid`;
  }
  if (drop.length > 0) await tx.category.deleteMany({ where: { id: { in: drop } } });

  // A moved category that is not the new default must not claim to be one.
  await tx.category.updateMany({
    where: { id: { in: keep.filter((id) => id !== promoteToDefault) } },
    data: { isDefault: false },
  });

  const counts = {
    categories: keep.length,
    expenses: await tx.expense.count({ where: { userId: from } }),
    recurring_rules: await tx.recurringRule.count({ where: { userId: from } }),
    goals: await tx.goal.count({ where: { userId: from } }),
  };
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  if (total > 0) {
    const revisions = await nextRevisionBlock(tx, into, total);
    let cursor = 0;
    for (const table of ['categories', 'expenses', 'recurring_rules', 'goals'] as const) {
      const count = counts[table];
      if (count === 0) continue;
      const base = (revisions[cursor] ?? 1) - 1;
      cursor += count;
      // Ranked by the old revision so the relative order of changes survives.
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" t
            SET "user_id" = $1::uuid, "revision" = $3::int + r.rn
           FROM (SELECT "id", row_number() OVER (ORDER BY "revision") AS rn
                   FROM "${table}" WHERE "user_id" = $2::uuid) r
          WHERE t."id" = r."id"`,
        into,
        from,
        base,
      );
    }
  }

  await tx.$executeRaw`UPDATE "expense_receipts" SET "user_id" = ${into}::uuid WHERE "user_id" = ${from}::uuid`;
  await tx.$executeRaw`DELETE FROM "sync_mutations" WHERE "user_id" = ${from}::uuid`;
}

/**
 * Make sure a person returning to their own books has a default category there.
 *
 * Only the creator of a household can be without one: their books moved into the household when
 * it was made, so after ownership is handed over and they leave, their own account is empty. A
 * book with no `Uncategorized` default cannot take an expense, so the seeded set is created.
 */
export async function ensureOwnDefaultCategory(tx: Db, userId: string): Promise<void> {
  const live = await tx.category.count({ where: { userId, deletedAt: null } });
  if (live > 0) return;

  const seeds = defaultCategories('en');
  const revisions = await nextRevisionBlock(tx, userId, seeds.length);
  const now = new Date();
  await tx.category.createMany({
    data: seeds.map((category, index) => ({
      id: uuidv7(),
      userId,
      name: category.name,
      color: category.color,
      isDefault: category.isDefault,
      updatedAt: now,
      revision: revisions[index] ?? 1,
    })),
  });
}

/**
 * Give a person back the private expenses they added to a household's book.
 *
 * Private means "only I see it", so when that person stops being a member - leaves, is removed,
 * or the household is deleted - their private expenses go with them rather than staying behind
 * in books they can no longer open. Each moves to their own account, filed under their category
 * of the same name (case-insensitively) or, failing that, their Uncategorized default, and gets
 * a fresh revision from their own counter so their devices pick it up when they resync.
 *
 * Shared expenses stay: they belong to the household. Deleted ones stay too - they are
 * placeholders to everyone else and have nothing to hand back.
 */
export async function handBackPrivateExpenses(
  tx: Db,
  bookId: string,
  memberId: string,
): Promise<void> {
  const rows = await tx.expense.findMany({
    where: { userId: bookId, createdBy: memberId, private: true, deletedAt: null },
    orderBy: { revision: 'asc' },
  });
  if (rows.length === 0) return;

  // Their own books may be empty (a creator who handed over and left): a category must exist.
  await ensureOwnDefaultCategory(tx, memberId);

  const theirs = await tx.category.findMany({ where: { userId: memberId, deletedAt: null } });
  const byName = new Map(theirs.map((category) => [category.name.toLowerCase(), category.id]));
  const fallback = theirs.find((category) => category.isDefault)?.id;
  if (fallback === undefined) throw new Error('a person returning to their books has no default');

  const bookCategories = await tx.category.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.categoryId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(bookCategories.map((category) => [category.id, category.name]));

  const revisions = await nextRevisionBlock(tx, memberId, rows.length);
  for (const [index, row] of rows.entries()) {
    const categoryId = byName.get((nameOf.get(row.categoryId) ?? '').toLowerCase()) ?? fallback;
    await tx.expense.update({
      where: { id: row.id },
      data: {
        userId: memberId,
        categoryId,
        private: false,
        revision: revisions[index] ?? 1,
      },
    });
  }
  await tx.expenseReceipt.updateMany({
    where: { expenseId: { in: rows.map((row) => row.id) } },
    data: { userId: memberId },
  });
}
