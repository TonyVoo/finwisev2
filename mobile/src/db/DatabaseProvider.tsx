import { type ReactNode, createContext, useContext } from 'react';
import type { SqliteDatabase } from './sqlite';

/**
 * Makes the open database available to hooks.
 *
 * The handle is passed in rather than opened here: opening it is async and has to finish
 * before the first screen renders (see `src/app/bootstrap.ts`), and taking it as a prop
 * is also what lets tests mount the real hooks over a `node:sqlite` database.
 */
const DatabaseContext = createContext<SqliteDatabase | null>(null);

export interface DatabaseProviderProps {
  readonly database: SqliteDatabase;
  readonly children: ReactNode;
}

export function DatabaseProvider({ database, children }: DatabaseProviderProps) {
  return <DatabaseContext.Provider value={database}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): SqliteDatabase {
  const database = useContext(DatabaseContext);
  if (database === null) {
    throw new Error('useDatabase must be used inside a DatabaseProvider');
  }
  return database;
}
