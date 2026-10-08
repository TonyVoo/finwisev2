import { getPrisma } from '../../src/db/client.ts';

/**
 * Reset the database between tests.
 *
 * Truncating is the right granularity here. A transaction-per-test rolled back at the
 * end would be faster, but the code under test opens its own transactions (signup, and
 * later the sync batch resolver) and nesting those inside an outer transaction changes
 * their isolation behaviour — which is exactly the behaviour the sync tests exist to
 * check. So: real commits, wiped afterwards.
 */

/** Prisma's own bookkeeping table. Dropping it would re-run every migration. */
const PRESERVED = new Set(['_prisma_migrations']);

let cachedTables: string[] | undefined;

/**
 * Discover the tables to wipe, rather than listing them.
 *
 * A hard-coded list goes stale silently: the table added in a later task simply does not
 * get truncated, and some test starts failing for reasons that have nothing to do with
 * it.
 */
async function tablesToTruncate(): Promise<string[]> {
  if (cachedTables) return cachedTables;
  const rows = await getPrisma().$queryRaw<{ tablename: string }[]>`
    SELECT "tablename" FROM "pg_tables" WHERE "schemaname" = current_schema()
  `;
  cachedTables = rows.map((r) => r.tablename).filter((t) => !PRESERVED.has(t));
  return cachedTables;
}

export async function truncateAll(): Promise<void> {
  const tables = await tablesToTruncate();
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t}"`).join(', ');
  // One statement so foreign keys never see a partially-wiped database. CASCADE covers
  // references from any table not in the list; RESTART IDENTITY resets sequences, which
  // matters because `revision_counters` is what the sync cursor is read from.
  await getPrisma().$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
