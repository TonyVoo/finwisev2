import type { SqliteDatabase, SqliteExecutor } from './sqlite';

/**
 * Who the local store belongs to, and what happens when that changes.
 *
 * The local database is one file shared by every account that logs in on the device
 * (`open.ts`), and until this module existed it carried no record of whose rows were in
 * it. So logging out and logging in as somebody else showed the previous user their
 * predecessor's expenses, month total and renamed categories - and the undrained outbox
 * those rows left behind would have been pushed under the new user's bearer token the day
 * the sync drain shipped, filing one account's spending into another's. `TVO-16`.
 *
 * **The rule, in one line: the store is stamped with its owner, and a session starting
 * under a different owner wipes it before the first read.**
 *
 * ### Why a wipe and not a partition
 *
 * The two candidate fixes were partitioning the store per user (a `userId` column, or a
 * file per user) and wiping it on a user change. Partitioning preserves a shared-device
 * user's data across a re-login, which is the only thing it buys - and
 * `docs/design/04-expense-list.md` §Behaviour rule 14 already gives that up, because it
 * specifies that logout "wipes the local database". So the extra cost buys nothing the
 * design asked for, and the cost is permanent: every query in the app, including every
 * one not yet written, would be one forgotten `WHERE userId = ?` away from the same leak.
 * A wipe fails closed - forget to call it and the tests here go red, rather than the data
 * quietly crossing accounts.
 *
 * ### What this must not do
 *
 * Wipe on a *forced* clear. A session that ends because the refresh token expired
 * (`token_invalid`) belongs to the user most likely to be holding unsynced work - someone
 * who has been offline past the 60-day window - and destroying it with no dialog is the
 * one outcome `docs/design/02-offline-and-sync.md` §5.3 argues hardest against: "a
 * stale-but-intact local database is strictly better than a clean one missing the user's
 * work." That path keeps the rows, and {@link LocalStore.adopt} is what stops them
 * reaching the next account. Pinned by `AUTH-12`.
 */

/** Where the owner is recorded in `meta`. */
export const OWNER_KEY = 'ownerUserId';

/** What {@link LocalStore.adopt} did. Returned so a caller - or a test - can tell. */
export type StoreAdoption =
  /** The store already belonged to this user. Its rows, outbox included, are intact. */
  | 'kept'
  /** The store was unowned and empty. Now owned, nothing deleted. */
  | 'claimed'
  /** The store held rows this user has no claim to. Deleted, then owned. */
  | 'wiped';

export interface LocalStore {
  /** The user id whose rows this store holds, or null when it is unclaimed. */
  readOwner(): Promise<string | null>;
  /**
   * Make the store safe for `userId` to read, and record them as its owner.
   *
   * Call this *before* publishing an authenticated session, never after: between the two
   * there is a window in which the route guards would let a screen read rows belonging to
   * somebody else.
   */
  adopt(userId: string): Promise<StoreAdoption>;
  /**
   * Delete every row and leave the store unowned - what an explicit logout does
   * (`docs/design/04-expense-list.md` §Behaviour rule 14).
   */
  clear(): Promise<void>;
}

/**
 * Tables a wipe empties, in an order that would hold even if foreign keys were on
 * (`outbox` references rows, rows reference nothing).
 */
const DATA_TABLES = ['outbox', 'expenses', 'categories'] as const;

async function readOwner(executor: SqliteExecutor): Promise<string | null> {
  const row = await executor.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [OWNER_KEY],
  );
  return row?.value ?? null;
}

/** Whether the store holds any user data at all. One query, three cheap existence checks. */
async function hasRows(executor: SqliteExecutor): Promise<boolean> {
  const row = await executor.getFirstAsync<{ present: number }>(
    `SELECT (EXISTS (SELECT 1 FROM categories)
          OR EXISTS (SELECT 1 FROM expenses)
          OR EXISTS (SELECT 1 FROM outbox)) AS present`,
    [],
  );
  return row?.present === 1;
}

async function deleteAllRows(txn: SqliteExecutor): Promise<void> {
  // `DATA_TABLES` is a literal, not input. The outbox's AUTOINCREMENT high-water mark is
  // deliberately left alone: `seq` only has to be monotonic among entries that coexist,
  // and writing to `sqlite_sequence` to make the next one read 1 is cosmetics against a
  // system table.
  for (const table of DATA_TABLES) {
    await txn.runAsync(`DELETE FROM ${table}`, []);
  }
}

export function createSqliteLocalStore(database: SqliteDatabase): LocalStore {
  return {
    readOwner: () => readOwner(database),

    async adopt(userId: string): Promise<StoreAdoption> {
      let adoption: StoreAdoption = 'kept';

      // One transaction, so the wipe and the stamp cannot be interrupted half-done. A
      // crash between them would otherwise leave a store that reads as owned but still
      // holds the old rows - the leak, with the guard against it already satisfied.
      await database.withExclusiveTransactionAsync(async (txn) => {
        const owner = await readOwner(txn);
        if (owner === userId) return;

        // An unowned store with rows in it is the one genuinely ambiguous case: a
        // database written before the owner was recorded, or one whose stamp was lost.
        // Its rows cannot be shown to belong to this user, so they are treated as
        // somebody else's. An unowned *empty* store is just a fresh install.
        adoption = owner === null && !(await hasRows(txn)) ? 'claimed' : 'wiped';
        if (adoption === 'wiped') await deleteAllRows(txn);

        await txn.runAsync(
          `INSERT INTO meta (key, value) VALUES (?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [OWNER_KEY, userId],
        );
      });

      return adoption;
    },

    async clear(): Promise<void> {
      await database.withExclusiveTransactionAsync(async (txn) => {
        await deleteAllRows(txn);
        await txn.runAsync('DELETE FROM meta WHERE key = ?', [OWNER_KEY]);
      });
    },
  };
}

/**
 * An in-memory {@link LocalStore}, for tests that have no database and for the web
 * preview target - the same role `createMemoryTokenStore` plays for the token store.
 *
 * It re-implements the decision rather than wrapping it, which is how a fake drifts from
 * the thing it stands in for, so `tests/db/localStore.test.ts` runs one behaviour table
 * against both implementations.
 */
export function createMemoryLocalStore(
  initial: { readonly owner?: string | null; readonly hasRows?: boolean } = {},
): LocalStore {
  let owner = initial.owner ?? null;
  let rows = initial.hasRows ?? false;

  return {
    readOwner: async () => owner,

    async adopt(userId: string): Promise<StoreAdoption> {
      if (owner === userId) return 'kept';
      const adoption: StoreAdoption = owner === null && !rows ? 'claimed' : 'wiped';
      rows = false;
      owner = userId;
      return adoption;
    },

    async clear(): Promise<void> {
      rows = false;
      owner = null;
    },
  };
}
