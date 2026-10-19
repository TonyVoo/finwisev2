/**
 * The narrow slice of `expo-sqlite` the app actually uses.
 *
 * Declaring a port instead of passing `SQLiteDatabase` around buys two things:
 *
 * 1. The store logic - migrations, the transactional write helper, the read queries -
 *    can be unit-tested against a real SQLite engine (`node:sqlite`) in jest, where no
 *    native module exists. These are the parts most worth testing and the ones hardest
 *    to test on a device.
 * 2. It is a written-down contract. `asSqliteDatabase` in `./open.ts` is the
 *    compile-time proof that `expo-sqlite` still satisfies it, so an upgrade that
 *    changes one of these signatures fails `pnpm typecheck` rather than at runtime on a
 *    phone.
 *
 * The proof lives there rather than here so that this module imports nothing at all.
 * `import type { SQLiteDatabase } from 'expo-sqlite'` is erased at runtime but still
 * *resolved* by `tsc`, which pulls `expo-modules-core` -> `react-native` ->
 * `@types/jsdom` into the program of whoever imports this file - and that is what made
 * the backend fail its own typecheck in two untouched files once a backend test reached
 * `db/localStore.ts` for `createMemoryLocalStore` (`TVO-33`, same leak as `TVO-23`).
 * `open.ts` already imports `expo-sqlite` as a value, so the proof costs nothing there.
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
