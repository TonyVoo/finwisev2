import {
  LIMITS,
  type SyncChange,
  type SyncPullQuery,
  type SyncPullResponse,
} from '@expense-tracker/shared';
import type { Db } from '../db/client.ts';
import { getPrisma } from '../db/client.ts';
import { toWireCategory, toWireExpense } from '../db/mappers.ts';
import { needsResync } from '../sync/resolver.ts';

/**
 * `GET /v1/sync` — pull every row of the user that changed after a revision watermark.
 *
 * The three things this has to get right, in order of how expensive they are to get
 * wrong:
 *
 *  1. **Never skip a row.** A skipped row is permanent, silent data loss on the device:
 *     the cursor has moved past it and nothing will ever send it again. See
 *     {@link readPage} for the snapshot that prevents it.
 *  2. **Never advance the cursor past what it returned.** `nextCursor` is the highest
 *     revision actually in `changes`, so the next page picks up exactly where this one
 *     stopped.
 *  3. **Say so when an incremental answer would be wrong**, rather than serving a page
 *     that quietly resurrects pruned deletes. That is `resyncRequired`.
 */

/** Both tables' rows for one page, plus the watermarks the decision needs. */
interface PageSnapshot {
  readonly lastRevision: number;
  readonly prunedThroughRevision: number;
  readonly changes: SyncChange[];
  readonly hasMore: boolean;
}

/**
 * The options the pull's transaction runs with, lifted out of the call so a test can
 * assert on them (`SYNC-57`, `GAP 18`).
 *
 * `RepeatableRead` is not a tuning choice, and nothing but a comment defended it before:
 * the behaviour it protects needs a write to commit in a window of roughly a tenth of a
 * millisecond between the page's two queries, so no behavioural test of it is reliable.
 * Naming the options makes the setting something a structural test can pin. The push side
 * has an equivalent constant (`PUSH_TRANSACTION_OPTIONS` in `syncPushService.ts`).
 */
export const PULL_TRANSACTION_OPTIONS = { isolationLevel: 'RepeatableRead' } as const;

/**
 * Read one page, and the user's watermarks, from a **single database snapshot**.
 *
 * The transaction is the load-bearing part, and `RepeatableRead` is why it exists rather
 * than being an optimisation. Categories and expenses are two tables, so a page is two
 * queries; under the default `READ COMMITTED` each statement gets its own snapshot, and
 * that is enough to lose a write:
 *
 *   - the categories query runs, and the user's highest revision is 40;
 *   - a write commits a category at revision 41 and an expense at revision 42;
 *   - the expenses query runs and returns revision 42.
 *
 * The merged page now contains 42 but not 41, `nextCursor` becomes 42, and the category
 * at revision 41 is never delivered to that device again. One shared snapshot makes the
 * two queries agree about what has committed, so a revision can only be missing from the
 * page if everything above it is missing too.
 *
 * `limit + 1` rows are taken from each table to decide `hasMore` without a second count.
 * Taking that many from *each* side is correct because the merged page's first
 * `limit + 1` entries are necessarily drawn from the first `limit + 1` of each table.
 */
async function readPage(
  db: Db,
  userId: string,
  since: number,
  limit: number,
): Promise<PageSnapshot> {
  const take = limit + 1;

  const run = async (tx: Db): Promise<PageSnapshot> => {
    const counter = await tx.revisionCounter.findUnique({ where: { userId } });
    const [categories, expenses] = await Promise.all([
      tx.category.findMany({
        where: { userId, revision: { gt: since } },
        orderBy: { revision: 'asc' },
        take,
      }),
      tx.expense.findMany({
        where: { userId, revision: { gt: since } },
        orderBy: { revision: 'asc' },
        take,
      }),
    ]);

    // A revision is handed out once per user across both tables, so merging on it is a
    // total order with no ties to break. Tombstones are in here by construction: the
    // predicate is on `revision`, and nothing filters `deletedAt` — a delete only
    // crosses the wire as a row with `deletedAt` set.
    const merged: { revision: number; change: SyncChange }[] = [
      ...categories.map((row) => ({
        revision: row.revision,
        change: { entity: 'category', record: toWireCategory(row) } satisfies SyncChange,
      })),
      ...expenses.map((row) => ({
        revision: row.revision,
        change: { entity: 'expense', record: toWireExpense(row) } satisfies SyncChange,
      })),
    ].sort((a, b) => a.revision - b.revision);

    return {
      // A user with no counter row cannot exist (it is created in the signup
      // transaction, and the FK cascades), so 0 here only ever means "the token outlived
      // the account" — which `pullChanges` answers as an empty, up-to-date page.
      lastRevision: counter?.lastRevision ?? 0,
      prunedThroughRevision: counter?.prunedThroughRevision ?? 0,
      changes: merged.slice(0, limit).map((entry) => entry.change),
      hasMore: merged.length > limit,
    };
  };

  // Already inside a transaction (a test, or a future composite endpoint): reuse it
  // rather than nesting, which Postgres would turn into a savepoint and which would not
  // change the isolation level anyway.
  const prisma = getPrisma();
  if (db !== prisma) return run(db);
  return prisma.$transaction(run, PULL_TRANSACTION_OPTIONS);
}

export async function pullChanges(
  db: Db,
  userId: string,
  query: SyncPullQuery,
): Promise<SyncPullResponse> {
  const since = query.since ?? 0;
  const limit = query.limit ?? LIMITS.SYNC_PULL_DEFAULT_LIMIT;

  const snapshot = await readPage(db, userId, since, limit);

  if (
    needsResync({
      since,
      serverRevision: snapshot.lastRevision,
      prunedThroughRevision: snapshot.prunedThroughRevision,
    })
  ) {
    // Deliberately not "here is a page, and also resync": the contract pins the other
    // fields so a client cannot half-apply a page it is about to throw away.
    return {
      changes: [],
      nextCursor: 0,
      hasMore: false,
      resyncRequired: true,
      serverTime: new Date().toISOString(),
    };
  }

  const last = snapshot.changes.at(-1);

  return {
    changes: snapshot.changes,
    // The highest revision *in this page*, never the user's watermark: on a page that
    // stopped at the limit those differ, and reporting the watermark would skip
    // everything between. Echoing `since` on an empty page lets an up-to-date client
    // store `nextCursor` unconditionally.
    nextCursor: last?.record.revision ?? since,
    hasMore: snapshot.hasMore,
    resyncRequired: false,
    serverTime: new Date().toISOString(),
  };
}
