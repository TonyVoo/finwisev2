import type { SqliteDatabase, SqliteExecutor } from './sqlite';

/**
 * Schema migrations for the local store, keyed on SQLite's `PRAGMA user_version`.
 *
 * The local schema mirrors the data model in `docs/PLAN.md` section 3 so that a pulled
 * server row maps onto a local row field-for-field. Two consequences of that:
 *
 * - **Columns are camelCase**, matching the wire contract in `@expense-tracker/shared`.
 *   A snake_case local schema would need a translation layer on every read and every
 *   write, and that layer is exactly where a dropped field hides.
 * - **`date` is TEXT `YYYY-MM-DD`**, not a timestamp and not an epoch number. It is the
 *   calendar day the user assigned to the expense and must not shift across timezones.
 *   Monthly totals bucket on `substr(date, 1, 7)`, which is why a lexicographically
 *   sortable format matters.
 *
 * Never edit a migration that has shipped - installed apps have already run it. Append
 * a new one.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Statements to apply. Run inside the migration transaction. */
  readonly up: string;
}

const INITIAL_SCHEMA = `
CREATE TABLE categories (
  -- Client-minted UUIDv7. The server stores it as-is, so this id is stable for the
  -- life of the row and safe to reference before the row has ever synced.
  id         TEXT    NOT NULL PRIMARY KEY,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL,
  isDefault  INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
  -- Server-assigned; NULL until this row has been round-tripped through sync.
  createdAt  TEXT,
  -- The edit time per the client clock. Last-write-wins orders on this.
  updatedAt  TEXT    NOT NULL,
  -- Tombstone. Non-NULL means deleted; the UI hides it but sync still carries it.
  deletedAt  TEXT,
  -- Server-assigned per-user monotonic revision. 0 means "never synced".
  revision   INTEGER NOT NULL DEFAULT 0
);

-- Covers the category list: live rows ordered by name.
CREATE INDEX idx_categories_live ON categories (deletedAt, name);

CREATE TABLE expenses (
  id           TEXT    NOT NULL PRIMARY KEY,
  -- No FOREIGN KEY: sync pulls rows ordered by revision, so an expense can legally
  -- arrive before the category it points at. Referential integrity is the server
  -- side of the contract (it answers "unknown_category"); locally a dangling
  -- categoryId renders as the fallback category rather than failing the write.
  categoryId   TEXT    NOT NULL,
  -- Integer minor units (cents). Never a float: 0.1 + 0.2 is not 0.3, and a month of
  -- rounding errors is a wrong total.
  amountMinor  INTEGER NOT NULL,
  currency     TEXT    NOT NULL,
  -- Calendar date "YYYY-MM-DD". Zone-less by design; see the module comment.
  date         TEXT    NOT NULL,
  note         TEXT,
  createdAt    TEXT,
  updatedAt    TEXT    NOT NULL,
  deletedAt    TEXT,
  revision     INTEGER NOT NULL DEFAULT 0
);

-- The expense list reads one month of live rows, newest first.
CREATE INDEX idx_expenses_live_date ON expenses (deletedAt, date DESC, id DESC);
-- Category deletion reassigns by categoryId, and the summary groups by it.
CREATE INDEX idx_expenses_category ON expenses (categoryId, deletedAt);

CREATE TABLE outbox (
  -- FIFO order of local mutations. AUTOINCREMENT, not a plain rowid: a plain rowid is
  -- reused after a delete, which would let a new entry sort before an older one.
  seq              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  entity           TEXT    NOT NULL CHECK (entity IN ('category', 'expense')),
  recordId         TEXT    NOT NULL,
  -- JSON object of just the mutated fields, matching CategorySyncFields /
  -- ExpenseSyncFields. A push is an upsert-with-merge, so sending the whole row would
  -- overwrite fields another device changed in the meantime.
  fields           TEXT    NOT NULL,
  updatedAt        TEXT    NOT NULL,
  -- Idempotency key for POST /v1/sync, minted once per mutation and reused across
  -- retries. UNIQUE so a replay can never be enqueued twice.
  clientMutationId TEXT    NOT NULL UNIQUE,
  queuedAt         TEXT    NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  lastError        TEXT
);

-- The drain reads categories first, then expenses, each in seq order.
CREATE INDEX idx_outbox_entity_seq ON outbox (entity, seq);
-- A row is "pending" iff an undrained outbox entry references its id.
CREATE INDEX idx_outbox_record ON outbox (entity, recordId);
`;

/**
 * Records *whose* rows this file holds, which v1 had no way to say.
 *
 * Without it the store is anonymous, so a second account logging in on the same device
 * reads the first account's categories and expenses, and - once the drain ships - pushes
 * the first account's outbox under the second account's bearer token (`TVO-16`). The
 * owner is what makes a user change detectable; `localStore.ts` holds the rule applied
 * when it changes.
 *
 * A key/value table rather than a `userId` column per row because the fix is a wipe, not
 * a partition. Partitioning would put a `userId` on `categories`, `expenses` and
 * `outbox`, and from then on every query in the app - including every one not yet
 * written - would be one forgotten `WHERE userId = ?` away from the same leak. One row
 * that says who owns the file cannot be forgotten by a query that does not mention it.
 */
const STORE_OWNER = `
CREATE TABLE meta (
  key   TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial-schema', up: INITIAL_SCHEMA },
  { version: 2, name: 'store-owner', up: STORE_OWNER },
];

/** Highest version `MIGRATIONS` can bring a database to. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);

async function readUserVersion(executor: SqliteExecutor): Promise<number> {
  const row = await executor.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  return row?.user_version ?? 0;
}

/**
 * Bring the database up to {@link LATEST_SCHEMA_VERSION} and return the version it is
 * now at. Idempotent: running it on an up-to-date database is a no-op, so it is safe to
 * call on every app start.
 *
 * Each migration is its own transaction, so a failure part-way through a multi-step
 * upgrade leaves the database at the last version that fully applied, rather than in a
 * state no migration describes.
 */
export async function migrate(database: SqliteDatabase): Promise<number> {
  // WAL keeps the sync drain writes from blocking the UI reads. `foreign_keys` is left
  // off deliberately - see the note on `expenses.categoryId`.
  await database.execAsync('PRAGMA journal_mode = WAL');

  let current = await readUserVersion(database);
  const pending = MIGRATIONS.filter((migration) => migration.version > current).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Migration ${migration.name} has a version that is not a positive integer`);
    }
    await database.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migration.up);
      // `PRAGMA user_version` takes no bind parameters, so the value is interpolated.
      // The integer check above is what keeps that safe.
      await txn.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    current = migration.version;
  }

  return current;
}
