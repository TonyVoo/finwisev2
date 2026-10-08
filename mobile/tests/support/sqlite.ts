import { DatabaseSync } from 'node:sqlite';
import type {
  SqliteBindParams,
  SqliteBindValue,
  SqliteDatabase,
  SqliteExecutor,
  SqliteRunResult,
} from '@/db/sqlite';

/**
 * A {@link SqliteDatabase} backed by Node's built-in SQLite, for unit tests.
 *
 * `expo-sqlite` is a native module with no JS implementation, so under jest there is no
 * database at all. Mocking it with an object that records calls would test nothing: the
 * parts of the store worth testing are the ones SQLite itself decides — that a rollback
 * really removes the row, that `NOT NULL` really fires, that `AUTOINCREMENT` really does
 * not reuse a seq. So these tests run against a real engine instead.
 *
 * It is the same engine family, driven through the same narrow port the app uses
 * (`src/db/sqlite.ts`), which is what makes the substitution honest. Two differences are
 * papered over here rather than in the app:
 *
 * - `node:sqlite` is synchronous; the port is async. Wrapping is trivial.
 * - `node:sqlite` rejects booleans as bind values where `expo-sqlite` accepts them, so
 *   they are normalised to 0/1 — the same thing `expo-sqlite` does internally.
 */

export interface TestDatabase extends SqliteDatabase {
  /** The underlying handle, for assertions that need to bypass the port. */
  readonly raw: DatabaseSync;
  close(): void;
}

type NodeBindValue = string | number | null | Uint8Array;

/**
 * `node:sqlite` binds positional and named parameters through different call shapes, so
 * the two cases stay apart rather than being flattened into one spread.
 */
type Bound =
  | { readonly kind: 'positional'; readonly values: NodeBindValue[] }
  | { readonly kind: 'named'; readonly values: Record<string, NodeBindValue> };

function toNodeBindValue(value: SqliteBindValue): NodeBindValue {
  // SQLite has no boolean type. `expo-sqlite` coerces; `node:sqlite` throws.
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

function bindParams(params: SqliteBindParams): Bound {
  if (Array.isArray(params)) {
    return { kind: 'positional', values: params.map(toNodeBindValue) };
  }
  const values: Record<string, NodeBindValue> = {};
  for (const [key, value] of Object.entries(params)) {
    values[key] = toNodeBindValue(value);
  }
  return { kind: 'named', values };
}

function createExecutor(database: DatabaseSync): SqliteExecutor {
  return {
    async execAsync(source: string): Promise<void> {
      database.exec(source);
    },

    async runAsync(source: string, params: SqliteBindParams): Promise<SqliteRunResult> {
      const statement = database.prepare(source);
      const bound = bindParams(params);
      const result =
        bound.kind === 'named' ? statement.run(bound.values) : statement.run(...bound.values);
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      };
    },

    async getAllAsync<T>(source: string, params: SqliteBindParams): Promise<T[]> {
      const statement = database.prepare(source);
      const bound = bindParams(params);
      const rows =
        bound.kind === 'named' ? statement.all(bound.values) : statement.all(...bound.values);
      return rows as T[];
    },

    async getFirstAsync<T>(source: string, params: SqliteBindParams): Promise<T | null> {
      const statement = database.prepare(source);
      const bound = bindParams(params);
      const row =
        bound.kind === 'named' ? statement.get(bound.values) : statement.get(...bound.values);
      return (row as T | undefined) ?? null;
    },
  };
}

/**
 * Open an in-memory database. Each call is an independent, empty database, so tests
 * cannot leak state into one another.
 */
export function createTestDatabase(): TestDatabase {
  const raw = new DatabaseSync(':memory:');
  const executor = createExecutor(raw);

  return {
    raw,
    ...executor,

    async withExclusiveTransactionAsync(task: (txn: SqliteExecutor) => Promise<void>) {
      // BEGIN IMMEDIATE, matching the exclusive semantics the port documents: the write
      // lock is taken up front rather than on the first write.
      raw.exec('BEGIN IMMEDIATE');
      try {
        await task(executor);
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
      raw.exec('COMMIT');
    },

    close() {
      raw.close();
    },
  };
}
