import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations';
import type { SqliteDatabase } from './sqlite';

/**
 * Narrow a real `expo-sqlite` handle to the port in `./sqlite`. The assignment is the
 * assertion: this stops compiling the moment the two disagree.
 *
 * It lives here, beside the only `openDatabaseAsync` call, rather than in `./sqlite`
 * with the port it checks. The port is imported by every store module and so, through
 * `db/localStore.ts`, by a backend test; a bare `import type` from `expo-sqlite` is
 * erased at runtime but still resolved by `tsc`, which would drag `react-native` and
 * `lib.dom` into that test's program (`TVO-33`). This file already imports
 * `expo-sqlite` as a value and is only ever reached from a device, so the proof is free
 * here and costly there.
 */
function asSqliteDatabase(database: SQLite.SQLiteDatabase): SqliteDatabase {
  return database;
}

/**
 * The on-device database file. Named rather than defaulted so a future migration that
 * has to start a new file can do so deliberately.
 */
export const DATABASE_NAME = 'expense-tracker.db';

/**
 * Open the local store and bring its schema up to date.
 *
 * Migrating here, before anything can read, is what lets every query assume the current
 * schema. Doing it lazily on first read would mean each read path needs a "schema not
 * ready" branch, and the one that forgot would fail on exactly the upgrade it was meant
 * to survive.
 */
export async function openLocalDatabase(name: string = DATABASE_NAME): Promise<SqliteDatabase> {
  const database = asSqliteDatabase(await SQLite.openDatabaseAsync(name));
  await migrate(database);
  return database;
}
