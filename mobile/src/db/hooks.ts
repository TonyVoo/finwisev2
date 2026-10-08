import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys } from '../query/keys';
import { useDatabase } from './DatabaseProvider';
import { type CategoryListItem, countPendingRecords, listLiveCategories } from './queries';

/**
 * The shape every read in this app takes: a SQLite query behind a TanStack Query key.
 *
 * Note what is missing from the call sites. No `isError` branch, because a local read
 * has no network to fail on. No `isLoading` spinner in the screens either - the query
 * resolves within a frame or two, and `docs/design/02-offline-and-sync.md` §1 forbids a
 * read spinner outright.
 *
 * Feature hooks land with their screens in later tasks. These two prove the pattern and
 * are what the scaffold's placeholder screens render.
 */

export function useLiveCategories(): UseQueryResult<readonly CategoryListItem[]> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.categories.live(),
    queryFn: () => listLiveCategories(database),
  });
}

/** Count behind the sync pill (`docs/design/02-offline-and-sync.md` §3). */
export function usePendingRecordCount(): UseQueryResult<number> {
  const database = useDatabase();
  return useQuery({
    queryKey: queryKeys.outbox.pendingCount(),
    queryFn: () => countPendingRecords(database),
  });
}
