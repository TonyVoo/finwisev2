import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../query/keys';
import { useDatabase } from './DatabaseProvider';
import type { SqliteDatabase } from './sqlite';

/**
 * How a screen performs a local write and gets the reads to agree with it.
 *
 * Every read in this app is a SQLite query behind a TanStack Query key, configured with
 * `staleTime: Infinity` and no refetching on mount, focus or reconnect (`query/client.ts`).
 * That is the right setting - a local read does not go stale on a clock - but it has a
 * consequence: **nothing re-reads unless something invalidates.** A write that skips the
 * invalidation leaves the screen showing the old rows, and the user has no way to make it
 * catch up short of restarting the app.
 *
 * `04-expense-list.md` rule 4 is the requirement this exists for: the total "recalculates
 * in the same render pass as the row change, so adding, editing or deleting never leaves
 * the total briefly stale."
 *
 * ### Why it invalidates everything local
 *
 * The invalidation is the whole `['local']` root rather than the handful of keys a given
 * write "obviously" affects, and that is deliberate. Work out the keys a single expense
 * delete actually touches:
 *
 * - its month's page and its month's total,
 * - `anyExist`, which decides between Home's two empty states,
 * - the months list behind the picker grid's dots,
 * - every category's expense count,
 * - the outbox pending count, and the `pending` flag on every row of two different
 *   lists - both derived from the outbox, so a write changes them even when it changed
 *   no visible field,
 * - and `lastUsed`, if the deleted row was the most recent one.
 *
 * Enumerating that per operation is a list nobody keeps correct, and getting it wrong
 * fails silently: the screen looks right, one number is stale, and it corrects itself on
 * the next unrelated write. Meanwhile the cost of being coarse is a few local SQLite
 * reads, each of which the architecture already assumes resolves within a frame
 * (`docs/design/02-offline-and-sync.md` §1). Correctness is worth more than the
 * microseconds, which is also why the keys were made hierarchical (`query/keys.ts`).
 */

/** A local write: it gets the database and returns whatever the caller needs back. */
export type LocalWrite<T> = (database: SqliteDatabase) => Promise<T>;

/**
 * Run `write`, then make every local read re-run.
 *
 * The invalidation is awaited, so by the time this resolves the screens have been handed
 * their new rows. A caller that navigates or raises a snackbar afterwards therefore does
 * it over up-to-date state rather than racing it.
 */
export function useLocalWrite(): <T>(write: LocalWrite<T>) => Promise<T> {
  const database = useDatabase();
  const queryClient = useQueryClient();

  return useCallback(
    async <T>(write: LocalWrite<T>): Promise<T> => {
      const result = await write(database);
      await queryClient.invalidateQueries({ queryKey: queryKeys.local() });
      return result;
    },
    [database, queryClient],
  );
}
