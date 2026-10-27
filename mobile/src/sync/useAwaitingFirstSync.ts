import { useQuery } from '@tanstack/react-query';
import { useDatabase } from '../db/DatabaseProvider';
import { useAnyExpensesExist } from '../db/hooks';
import { queryKeys } from '../query/keys';
import { useOptionalSyncStatus } from './SyncProvider';
import { readLastSyncedAt } from './cursor';

/**
 * Whether this device has never completed a sync and holds nothing to show yet.
 *
 * An empty local store means two different things. After a completed sync it means the
 * account really has no expenses, and `$0.00` / "Add your first expense" are true. Before
 * one it means *we do not know yet*: a returning user on a new phone has an owned, empty
 * store until the first pull lands, and stating `$0.00` to someone with hundreds of
 * expenses reads exactly like the app lost their data (`TVO-34`).
 *
 * So the two screens that state a total hold their skeleton for as long as this is true,
 * rather than for the 300ms `useFirstPaintSkeleton` allows a local read. It ends the moment
 * a sync has completed - in this run (the engine's status) or an earlier one (the persisted
 * value, which is what a cold start has before the engine has looked) - or any expense is
 * present locally. It never applies where no sync engine is mounted at all.
 *
 * If the first pull fails, the skeleton stays and the sync pill says why, which is the
 * honest pair: "not loaded, and here is the problem" beats "loaded, and empty".
 */
export function useAwaitingFirstSync(): boolean {
  const status = useOptionalSyncStatus();
  const database = useDatabase();
  const anyExist = useAnyExpensesExist();
  const persisted = useQuery({
    queryKey: queryKeys.lastSyncedAt(),
    queryFn: () => readLastSyncedAt(database),
  });

  if (status === null) return false;
  if (status.lastSyncedAt !== null) return false;
  // Unresolved is not "never": the read is a frame away, and the screens' own first-paint
  // skeleton covers it.
  if (persisted.data === undefined || persisted.data !== null) return false;
  return anyExist.data !== true;
}
