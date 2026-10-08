import type { Db } from './client.ts';

/**
 * Hand out the next `revision` for a user.
 *
 * `revision` is the watermark `GET /v1/sync?since=` walks, which puts two hard
 * requirements on it: per-user, and gap-free ascending. A timestamp satisfies neither —
 * two rows written in the same millisecond are indistinguishable, and a cursor can be
 * advanced past a row whose transaction had not yet committed, so the row is silently
 * never delivered. A Postgres `SEQUENCE` fails too: global, and it leaves gaps when a
 * transaction rolls back.
 *
 * So it is a counter row per user, incremented by the `next_revision()` SQL function
 * (see the first migration). Two consequences the caller must respect:
 *
 *  1. **Call this inside the transaction that performs the write.** The increment is
 *     part of that transaction, so a rollback returns the number and the sequence stays
 *     gap-free. Stamping a row with a revision from a separate transaction reintroduces
 *     exactly the hole the design avoids.
 *  2. Concurrent writers for the same user serialise on the counter's row lock, so no
 *     two rows can ever receive the same revision.
 */
export async function nextRevision(db: Db, userId: string): Promise<number> {
  const rows = await db.$queryRaw<{ next_revision: number }[]>`
    SELECT "next_revision"(${userId}::uuid) AS "next_revision"
  `;
  const revision = rows[0]?.next_revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    // Only reachable if the user's counter row is missing, which the signup transaction
    // and the FK make impossible. Loud rather than silent: a row stamped with a bad
    // revision is a row no client would ever see.
    throw new Error(`next_revision() returned ${String(revision)} for user ${userId}`);
  }
  return revision;
}

/**
 * Allocate `count` consecutive revisions in one round trip, returned in ascending order.
 *
 * Signup seeds six categories; a sync push can carry hundreds of rows. One statement per
 * row would be that many round trips, so callers that know their batch size up front
 * take the block and assign from it in order.
 */
export async function nextRevisionBlock(db: Db, userId: string, count: number): Promise<number[]> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`nextRevisionBlock: count must be a positive integer, got ${String(count)}`);
  }
  const rows = await db.$queryRaw<{ last_revision: number }[]>`
    SELECT "next_revision_block"(${userId}::uuid, ${count}::int) AS "last_revision"
  `;
  const last = rows[0]?.last_revision;
  if (typeof last !== 'number' || !Number.isInteger(last) || last < count) {
    throw new Error(`next_revision_block() returned ${String(last)} for user ${userId}`);
  }
  const first = last - count + 1;
  return Array.from({ length: count }, (_, i) => first + i);
}
