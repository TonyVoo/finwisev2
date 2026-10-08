import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations';
import { type SqliteDatabase, asSqliteDatabase } from './sqlite';

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
