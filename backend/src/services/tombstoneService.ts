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
 *
 * The same job also bounds the idempotency ledger (`sync_mutations`), on the same 90-day
 * horizon. Keeping every `clientMutationId` forever is the *safe* answer for
 * de-duplication, so that is a cost problem rather than a correctness one: the ledger was
 * the only table in the schema with no ceiling. The two windows are deliberately one
 * number, not two, because a client resyncing at the tombstone horizon is exactly the
 * client most likely to be replaying mutation ids from before it — letting the ledger
 * expire first would mean a replay of an id the server has forgotten while the deletes it
 * raced against are still on file. See `docs/PLAN.md` §4 for what expiry changes.
 */

export interface PruneResult {
  readonly expenses: number;
  readonly categories: number;
  readonly recurring: number;
  /** Idempotency-ledger rows swept on the same horizon. */
  readonly ledgerEntries: number;
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

    // No foreign key points at or from a rule's category, so this has no ordering
    // constraint against the other two; it sits here only to keep the destructive
    // statements together.
    const recurring = await tx.$queryRaw<{ revision: number }[]>`
      DELETE FROM "recurring_rules"
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

    // The ledger sweep. Unrelated to the two above — no foreign key, no revision, and
    // nothing in a pull depends on it — so it is ordered last and ages on `created_at`
    // (when the mutation was recorded) rather than on a `deleted_at` it does not have.
    // Past the horizon an id stops being de-duplicated, which is a behaviour change and
    // not a cleanup: a delete-then-recreate under the same id would apply a second time,
    // and an `invalid` result a client was replaying to re-read stops being replayable.
    // Both are fine at 90 days and neither would be at 90 minutes, which is the whole
    // reason the number is written down in the contract instead of only living here.
    const ledgerEntries = await tx.syncMutation.deleteMany({
      where: { userId, createdAt: { lt: horizon } },
    });

    const retained = await tx.category.count({
      where: { userId, deletedAt: { not: null, lt: horizon } },
    });

    const counter = await tx.revisionCounter.findUnique({ where: { userId } });
    const deletedRevisions = [...expenses, ...recurring, ...categories].map((row) => row.revision);
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
      recurring: recurring.length,
      ledgerEntries: ledgerEntries.count,
      categoriesRetained: retained,
      prunedThroughRevision,
    };
  };

  const prisma = getPrisma();
  return db === prisma ? prisma.$transaction(run) : run(db);
}

/**
 * Prune every user with at least one tombstone — or one ledger entry — past the horizon.
 *
 * Per-user transactions rather than one sweeping statement: the watermark is per-user,
 * and a single transaction over every account would hold locks across the whole table
 * for as long as the slowest account takes.
 *
 * Discovery is a `UNION ALL` over all three swept tables, and the `sync_mutations` branch
 * is load-bearing rather than belt-and-braces. Without it the ledger sweep inside
 * `pruneTombstones` would never run for an account that has pushed mutations and deleted
 * nothing — which is the ordinary user, somebody who adds expenses and never deletes a
 * category. That account has no tombstone anywhere, so the other two branches cannot see
 * it, and it is precisely the account whose ledger grows unchecked.
 */
export async function pruneAllTombstones(now = new Date()): Promise<{
  users: number;
  expenses: number;
  categories: number;
  recurring: number;
  ledgerEntries: number;
}> {
  const db = getPrisma();
  const horizon = tombstoneHorizon(now);

  const userIds = await db.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT "user_id" FROM (
      SELECT "user_id" FROM "categories" WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${horizon}
      UNION ALL
      SELECT "user_id" FROM "expenses"   WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${horizon}
      UNION ALL
      SELECT "user_id" FROM "recurring_rules" WHERE "deleted_at" IS NOT NULL AND "deleted_at" < ${horizon}
      UNION ALL
      SELECT "user_id" FROM "sync_mutations" WHERE "created_at" < ${horizon}
    ) AS "stale"
  `;

  let expenses = 0;
  let categories = 0;
  let recurring = 0;
  let ledgerEntries = 0;
  for (const { user_id: userId } of userIds) {
    const result = await pruneTombstones(db, userId, now);
    expenses += result.expenses;
    categories += result.categories;
    recurring += result.recurring;
    ledgerEntries += result.ledgerEntries;
  }

  logger.info('tombstones pruned', {
    horizonDays: TOMBSTONE_HORIZON_DAYS,
    users: userIds.length,
    expenses,
    categories,
    recurring,
    ledgerEntries,
  });
  return { users: userIds.length, expenses, categories, recurring, ledgerEntries };
}
