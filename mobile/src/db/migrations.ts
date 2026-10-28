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

/**
 * The signed-in user's own row, written at signup and at login
 * (`docs/design/03-auth.md` §1.2 rule 7 and §1.3 rule 4).
 *
 * It is here because the app has to work on a cold start with no network, and two things
 * it renders on the first frame come from this row rather than from the session: the
 * user's `currency`, which every amount in the app is formatted with, and their `email`,
 * which Settings shows. Reading those from `GET /v1/me` would make a launch on a plane
 * wait on a request that cannot succeed.
 *
 * `onlyRow` makes "there is at most one user" a schema invariant rather than a
 * convention: the `CHECK` plus the primary key mean a second row cannot be inserted even
 * by a future caller who forgot. The id is a column like any other, so a different user
 * signing in is an update, not an insert.
 *
 * It is registered in `localStore.ts`'s wipe list, which is the part that matters for
 * `TVO-16`: a table holding one account's email that survived a user change would be the
 * same leak in a smaller place.
 */
const USER_PROFILE = `
CREATE TABLE user (
  onlyRow   INTEGER NOT NULL PRIMARY KEY CHECK (onlyRow = 1),
  id        TEXT    NOT NULL,
  email     TEXT    NOT NULL,
  currency  TEXT    NOT NULL,
  createdAt TEXT    NOT NULL
);
`;

/**
 * Rows the server refused, so the `needs-attention` state survives the drain.
 *
 * A push that comes back `invalid` clears its outbox entry - retrying a mutation the
 * server has already said no to is a battery and bandwidth leak with no path to
 * success. But clearing it also erases the only evidence anything went wrong, and the
 * row would silently revert to looking `synced` while the server has never stored it.
 * `docs/design/02-offline-and-sync.md` §5.1 wants the opposite: the row keeps an
 * `alert-circle` and a tappable way to fix it.
 *
 * It is a separate table rather than a column on `categories`/`expenses` because the
 * rejection is a fact about a *push*, not about the row, and because a column would
 * have to be cleared by every write path that could possibly repair it. Derived
 * instead: a row is `needs-attention` when a rejection names it **and no outbox entry
 * does**. Re-queueing the row therefore clears the flag by itself
 * (§5.1, "saving re-queues the row and clears the flag"), with no second write to
 * forget.
 */
const SYNC_REJECTIONS = `
CREATE TABLE sync_rejections (
  entity     TEXT NOT NULL CHECK (entity IN ('category', 'expense')),
  recordId   TEXT NOT NULL,
  -- One of SYNC_RECORD_ERROR_CODES. The expense form branches on it (§5.1).
  code       TEXT NOT NULL,
  message    TEXT NOT NULL,
  rejectedAt TEXT NOT NULL,
  -- One standing rejection per row: a later push replaces it or resolves it.
  PRIMARY KEY (entity, recordId)
);
`;

/**
 * A category's monthly budget, in minor units. NULL means no budget; the contract forbids 0
 * (`shared/src/category.ts`), so an unset and a zero budget cannot be confused. Added with
 * `ALTER TABLE` because SQLite can add a nullable column in place - no table rebuild.
 */
const CATEGORY_BUDGET = `
ALTER TABLE categories ADD COLUMN monthlyBudgetMinor INTEGER
  CHECK (monthlyBudgetMinor IS NULL OR monthlyBudgetMinor >= 1);
`;

/**
 * Recurring expenses: the rules table, and the two CHECKs that name the entities.
 *
 * SQLite cannot alter a CHECK, so `outbox` and `sync_rejections` are rebuilt to allow
 * `'recurring'` - create, copy, drop, rename, recreate the indexes. Every row is carried
 * across, **including the undrained queue**, and the AUTOINCREMENT high-water mark is
 * carried too, because `seq` must stay monotonic among entries that coexist and a drained
 * queue that restarted at 1 would let a new entry sort before one a stale reader holds.
 *
 * The rule has no `nextDate` and no foreign key, mirroring the server (`shared/src/
 * recurring.ts`): occurrences are computed from `startDate`, and a rule whose category is
 * gone is filed under the fallback at generation time.
 */
const RECURRING = `
CREATE TABLE recurring (
  id          TEXT    NOT NULL PRIMARY KEY,
  categoryId  TEXT    NOT NULL,
  amountMinor INTEGER NOT NULL,
  currency    TEXT    NOT NULL,
  note        TEXT,
  frequency   TEXT    NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  startDate   TEXT    NOT NULL,
  endDate     TEXT,
  createdAt   TEXT,
  updatedAt   TEXT    NOT NULL,
  deletedAt   TEXT,
  revision    INTEGER NOT NULL DEFAULT 0,
  CHECK (endDate IS NULL OR endDate >= startDate)
);

CREATE INDEX idx_recurring_live ON recurring (deletedAt, startDate);

CREATE TABLE outbox_v6 (
  seq              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  entity           TEXT    NOT NULL CHECK (entity IN ('category', 'recurring', 'expense')),
  recordId         TEXT    NOT NULL,
  fields           TEXT    NOT NULL,
  updatedAt        TEXT    NOT NULL,
  clientMutationId TEXT    NOT NULL UNIQUE,
  queuedAt         TEXT    NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  lastError        TEXT
);
INSERT INTO outbox_v6 (seq, entity, recordId, fields, updatedAt, clientMutationId, queuedAt, attempts, lastError)
  SELECT seq, entity, recordId, fields, updatedAt, clientMutationId, queuedAt, attempts, lastError
    FROM outbox;
DELETE FROM sqlite_sequence WHERE name = 'outbox_v6';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'outbox_v6', COALESCE(MAX(seq), 0) FROM sqlite_sequence WHERE name = 'outbox';
DROP TABLE outbox;
ALTER TABLE outbox_v6 RENAME TO outbox;
CREATE INDEX idx_outbox_entity_seq ON outbox (entity, seq);
CREATE INDEX idx_outbox_record ON outbox (entity, recordId);

CREATE TABLE sync_rejections_v6 (
  entity     TEXT NOT NULL CHECK (entity IN ('category', 'recurring', 'expense')),
  recordId   TEXT NOT NULL,
  code       TEXT NOT NULL,
  message    TEXT NOT NULL,
  rejectedAt TEXT NOT NULL,
  PRIMARY KEY (entity, recordId)
);
INSERT INTO sync_rejections_v6 (entity, recordId, code, message, rejectedAt)
  SELECT entity, recordId, code, message, rejectedAt FROM sync_rejections;
DROP TABLE sync_rejections;
ALTER TABLE sync_rejections_v6 RENAME TO sync_rejections;
`;

/**
 * Whether the account's email is verified, kept beside the rest of the user row so Settings
 * can show it offline. 0 until the server says otherwise: an old row (or an old server that
 * never sends the field) reads as unverified, which only means Settings offers the check.
 */
const EMAIL_VERIFIED = `
ALTER TABLE user ADD COLUMN emailVerified INTEGER NOT NULL DEFAULT 0 CHECK (emailVerified IN (0, 1));
`;

/**
 * Receipt photos, one per expense, kept on the device and mirrored to the server.
 *
 * `state` is what the sync step has still to do about the row:
 *   - `pending-upload`: the person attached this image here; it has not reached the server.
 *   - `pending-delete`: the person removed it here; the server still has it. No image bytes.
 *   - `synced`: the server has exactly this image.
 *   - `remote`: the server has one (another device took it) and this device has not
 *     downloaded it yet; `dataBase64` is NULL until it is opened.
 * The image is base64 text, as the wire carries it, so nothing is re-encoded on the way in
 * or out. No foreign key to `expenses`: a receipt can be queued for an expense whose own
 * outbox entry has not drained, and the table is wiped with everything else.
 */
const RECEIPTS = `
CREATE TABLE receipts (
  expenseId  TEXT PRIMARY KEY,
  state      TEXT NOT NULL CHECK (state IN ('pending-upload', 'pending-delete', 'synced', 'remote')),
  dataBase64 TEXT,
  sizeBytes  INTEGER NOT NULL DEFAULT 0,
  updatedAt  TEXT NOT NULL
);
`;

/**
 * Income: `kind` on `expenses`. Income shares the table so it syncs, exports and attaches
 * receipts like any entry; every spend total filters on `kind = 'expense'`.
 */
const ENTRY_KIND = `
ALTER TABLE expenses ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense'
  CHECK (kind IN ('expense', 'income'));
`;

/**
 * Savings goals: the goals table, and the two CHECKs that name the entities, rebuilt the same
 * way migration 6 did for recurring rules (create, copy, drop, rename, recreate the indexes),
 * carrying the undrained queue and the AUTOINCREMENT high-water mark across.
 *
 * Progress is manual, so `savedMinor` is just a column the device writes on a deposit; the
 * target is at least 1 and the saved amount never negative, as on the server.
 */
const GOALS = `
CREATE TABLE goals (
  id          TEXT    NOT NULL PRIMARY KEY,
  name        TEXT    NOT NULL,
  targetMinor INTEGER NOT NULL CHECK (targetMinor >= 1),
  savedMinor  INTEGER NOT NULL DEFAULT 0 CHECK (savedMinor >= 0),
  currency    TEXT    NOT NULL,
  deadline    TEXT,
  createdAt   TEXT,
  updatedAt   TEXT    NOT NULL,
  deletedAt   TEXT,
  revision    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_goals_live ON goals (deletedAt, name);

CREATE TABLE outbox_v10 (
  seq              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  entity           TEXT    NOT NULL CHECK (entity IN ('category', 'recurring', 'goal', 'expense')),
  recordId         TEXT    NOT NULL,
  fields           TEXT    NOT NULL,
  updatedAt        TEXT    NOT NULL,
  clientMutationId TEXT    NOT NULL UNIQUE,
  queuedAt         TEXT    NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  lastError        TEXT
);
INSERT INTO outbox_v10 (seq, entity, recordId, fields, updatedAt, clientMutationId, queuedAt, attempts, lastError)
  SELECT seq, entity, recordId, fields, updatedAt, clientMutationId, queuedAt, attempts, lastError
    FROM outbox;
DELETE FROM sqlite_sequence WHERE name = 'outbox_v10';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'outbox_v10', COALESCE(MAX(seq), 0) FROM sqlite_sequence WHERE name = 'outbox';
DROP TABLE outbox;
ALTER TABLE outbox_v10 RENAME TO outbox;
CREATE INDEX idx_outbox_entity_seq ON outbox (entity, seq);
CREATE INDEX idx_outbox_record ON outbox (entity, recordId);

CREATE TABLE sync_rejections_v10 (
  entity     TEXT NOT NULL CHECK (entity IN ('category', 'recurring', 'goal', 'expense')),
  recordId   TEXT NOT NULL,
  code       TEXT NOT NULL,
  message    TEXT NOT NULL,
  rejectedAt TEXT NOT NULL,
  PRIMARY KEY (entity, recordId)
);
INSERT INTO sync_rejections_v10 (entity, recordId, code, message, rejectedAt)
  SELECT entity, recordId, code, message, rejectedAt FROM sync_rejections;
DROP TABLE sync_rejections;
ALTER TABLE sync_rejections_v10 RENAME TO sync_rejections;
`;

/**
 * Foreign-currency expenses: what was actually paid, beside the account-currency amount.
 *
 * `amountMinor` keeps meaning "in the account currency", so every total, budget and chart is
 * untouched; these two columns only record the original. Existing rows are NULL, NULL. The
 * CHECKs mirror the server's: both or neither, and never the account's own currency (which
 * is why `currency` is on the row at all).
 */
const FOREIGN_AMOUNTS = `
ALTER TABLE expenses ADD COLUMN originalAmountMinor INTEGER
  CHECK (originalAmountMinor IS NULL OR originalAmountMinor >= 0);
ALTER TABLE expenses ADD COLUMN originalCurrency TEXT;
CREATE TRIGGER expenses_original_pair_insert
  BEFORE INSERT ON expenses
  WHEN (NEW.originalAmountMinor IS NULL) <> (NEW.originalCurrency IS NULL)
     OR NEW.originalCurrency = NEW.currency
BEGIN
  SELECT RAISE(ABORT, 'original amount and currency go together, and differ from the account currency');
END;
CREATE TRIGGER expenses_original_pair_update
  BEFORE UPDATE ON expenses
  WHEN (NEW.originalAmountMinor IS NULL) <> (NEW.originalCurrency IS NULL)
     OR NEW.originalCurrency = NEW.currency
BEGIN
  SELECT RAISE(ABORT, 'original amount and currency go together, and differ from the account currency');
END;
`;

/**
 * Who added an expense: the server's `createdBy`, which a pull writes and the device only reads.
 * NULL for rows from before it was recorded and for rows made here until the server answers.
 * Not a foreign key: the author may be someone else, and may since have left.
 */
const EXPENSE_AUTHOR = `
ALTER TABLE expenses ADD COLUMN createdBy TEXT;
`;

/** The account's display name, kept so Settings can show it offline. NULL when none is chosen. */
const DISPLAY_NAME = `
ALTER TABLE user ADD COLUMN displayName TEXT;
`;

/**
 * Private expenses: hidden from the rest of a household. A device only ever holds its own
 * private rows as real ones - for everyone else the server sends a deleted placeholder - so this
 * flag is what the author's lists mark with a lock and their totals report separately.
 */
const PRIVATE_EXPENSES = `
ALTER TABLE expenses ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial-schema', up: INITIAL_SCHEMA },
  { version: 2, name: 'store-owner', up: STORE_OWNER },
  { version: 3, name: 'user-profile', up: USER_PROFILE },
  { version: 4, name: 'sync-rejections', up: SYNC_REJECTIONS },
  { version: 5, name: 'category-budget', up: CATEGORY_BUDGET },
  { version: 6, name: 'recurring', up: RECURRING },
  { version: 7, name: 'email-verified', up: EMAIL_VERIFIED },
  { version: 8, name: 'receipts', up: RECEIPTS },
  { version: 9, name: 'entry-kind', up: ENTRY_KIND },
  { version: 10, name: 'savings-goals', up: GOALS },
  { version: 11, name: 'foreign-amounts', up: FOREIGN_AMOUNTS },
  { version: 12, name: 'expense-author', up: EXPENSE_AUTHOR },
  { version: 13, name: 'display-name', up: DISPLAY_NAME },
  { version: 14, name: 'private-expenses', up: PRIVATE_EXPENSES },
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
