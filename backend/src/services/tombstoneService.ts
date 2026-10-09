import type { Db } from '../db/client.ts';
import { getPrisma } from '../db/client.ts';
import { logger } from '../logger.ts';
import { TOMBSTONE_HORIZON_DAYS, tombstoneHorizon } from '../sync/resolver.ts';

/**
 * Pruning tombstones, and the watermark that makes it safe.
 *
 * A soft delete is how a delete crosses the wire: an absent row is indistinguishable
 * from one the client has never seen, so `deletedAt` is the only thing that can tell a
 * device to drop its copy. The cost is that tombstones accumulate forever, which is why
 * they are pruned after 90 days.
 *
 * Pruning on its own would be a correctness bug, not a cleanup. A client that has been
 * offline for longer than the horizon asks for `since = <old watermark>`, the pruned
 * tombstone is no longer there to send, and the client keeps a row the server deleted —
 * silently, forever. So every prune records how far it got in
 * `revision_counters.pruned_through_revision`, and `GET /v1/sync` answers
 * `resyncRequired: true` to any `since` below it. The watermark is the horizon expressed
 * in the only unit a sync cursor understands.
 *
 * This is not invoked from a request path. `GET /v1/sync` is a read, and making it write
 * would put a counter update on every poll from every device. It runs from
 * `src/scripts/pruneTombstones.ts`, on a schedule; see `backend/README.md`.
 */

export interface PruneResult {
  readonly expenses: number;
  readonly categories: number;
  /** Rows older than the horizon that could not be pruned yet; see below. */
  readonly categoriesRetained: number;
  /** The watermark after this run. */
  readonly prunedThroughRevision: number;
}

/**
 * Delete this user's tombstones older than the horizon, and advance the watermark.
 *
 * Expenses first, then categories, for a reason the foreign key enforces: an expense
 * references its category with `ON DELETE RESTRICT`, and a tombstoned expense keeps
 * pointing at the category it had when it was deleted — a category delete reassigns only
 * *live* expenses. A category tombstone with surviving expense tombstones therefore
 * cannot be removed yet, and is left for the next run rather than cascading, because
 * cascading would destroy spend history to tidy up a category.
 *
 * The whole thing is one transaction so the watermark can never be advanced past rows
 * that were not actually deleted, which would strand clients for nothing.
 */
export async function pruneTombstones(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<PruneResult> {
  const horizon = tombstoneHorizon(now);

  const run = async (tx: Db): Promise<PruneResult> => {
    const expenses = await tx.$queryRaw<{ revision: number }[]>`
      DELETE FROM "expenses"
       WHERE "user_id" = ${userId}::uuid
         AND "deleted_at" IS NOT NULL
         AND "deleted_at" < ${horizon}
      RETURNING "revision"
    `;

    const categories = await tx.$queryRaw<{ revision: number }[]>`
      DELETE FROM "categories"
       WHERE "user_id" = ${userId}::uuid
         AND "deleted_at" IS NOT NULL
         AND "deleted_at" < ${horizon}
         AND NOT EXISTS (
           SELECT 1 FROM "expenses" AS "e" WHERE "e"."category_id" = "categories"."id"
         )
      RETURNING "revision"
    `;

    const retained = await tx.category.count({
      where: { userId, deletedAt: { not: null, lt: horizon } },
    });

    const counter = await tx.revisionCounter.findUnique({ where: { userId } });
    const deletedRevisions = [...expenses, ...categories].map((row) => row.revision);
    // The watermark is the *highest* revision destroyed, not a count: a client whose
    // `since` is at or above it has already seen every delete that was pruned, so it can
    // still be served incrementally. Monotonic, because a lower value would re-open a
    // window that has already been closed.
    const prunedThroughRevision = Math.max(
      counter?.prunedThroughRevision ?? 0,
      ...deletedRevisions,
      0,
    );

    if (counter && prunedThroughRevision !== counter.prunedThroughRevision) {
      await tx.revisionCounter.update({
        where: { userId },
        data: { prunedThroughRevision },
      });
    }

    return {
      expenses: expenses.length,
      categories: categories.length,
      categoriesRetained: retained,
      prunedThroughRevision,
    };
  };

  const prisma = getPrisma();
  return db === prisma ? prisma.$transaction(run) : run(db);
}

/**
 * Prune every user with at least one tombstone past the horizon.
 *
 * Per-user transactions rather than one sweeping statement: the watermark is per-user,
 * and a single transaction over every account would hold locks across the whole table
 * for as long as the slowest account takes.
 */
export async function pruneAllTombstones(now = new Date()): Promise<{
  users: number;
  expenses: number;
  categories: number;
}> {
  const db = getPrisma();
  const horizon = tombstoneHorizon(now);

  const userIds = await db.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT "user_id" FROM (
      SELECT "user_id" FROM "categories" WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${horizon}
      UNION ALL
      SELECT "user_id" FROM "expenses"   WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${horizon}
    ) AS "stale"
  `;

  let expenses = 0;
  let categories = 0;
  for (const { user_id: userId } of userIds) {
    const result = await pruneTombstones(db, userId, now);
    expenses += result.expenses;
    categories += result.categories;
  }

  logger.info('tombstones pruned', {
    horizonDays: TOMBSTONE_HORIZON_DAYS,
    users: userIds.length,
    expenses,
    categories,
  });
  return { users: userIds.length, expenses, categories };
}
