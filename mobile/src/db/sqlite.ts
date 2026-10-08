import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * The narrow slice of `expo-sqlite` the app actually uses.
 *
 * Declaring a port instead of passing `SQLiteDatabase` around buys two things:
 *
 * 1. The store logic - migrations, the transactional write helper, the read queries -
 *    can be unit-tested against a real SQLite engine (`node:sqlite`) in jest, where no
 *    native module exists. These are the parts most worth testing and the ones hardest
 *    to test on a device.
 * 2. It is a written-down contract. `asSqliteDatabase` below is the compile-time proof
 *    that `expo-sqlite` still satisfies it, so an upgrade that changes one of these
 *    signatures fails `pnpm typecheck` rather than at runtime on a phone.
 */

export type SqliteBindValue = string | number | null | boolean | Uint8Array;
export type SqliteBindParams = SqliteBindValue[] | Record<string, SqliteBindValue>;

export interface SqliteRunResult {
  readonly lastInsertRowId: number;
  readonly changes: number;
}

/** Statement execution. Both a database and an open transaction provide this. */
export interface SqliteExecutor {
  /** Run one or more statements with no parameters and no result. */
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqliteBindParams): Promise<SqliteRunResult>;
  getAllAsync<T>(source: string, params: SqliteBindParams): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqliteBindParams): Promise<T | null>;
}

export interface SqliteDatabase extends SqliteExecutor {
  /**
   * Run `task` in a transaction that commits on return and rolls back if it throws.
   *
   * Deliberately the *exclusive* variant. The non-exclusive `withTransactionAsync` does
   * not stop unrelated awaited queries from interleaving into the open transaction,
   * which would let an unrelated statement be rolled back along with ours - or, worse,
   * let our row write commit while its outbox entry does not.
   */
  withExclusiveTransactionAsync(task: (txn: SqliteExecutor) => Promise<void>): Promise<void>;
}

/**
 * Narrow a real `expo-sqlite` handle to the port. The assignment is the assertion: this
 * stops compiling the moment the two disagree.
 */
export function asSqliteDatabase(database: SQLiteDatabase): SqliteDatabase {
  return database;
}
