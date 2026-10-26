import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query, configured for a cache whose source is local SQLite rather than a
 * network.
 *
 * Almost every default in the library assumes the opposite - that data is remote, goes
 * stale on its own, and is worth re-fetching when the user comes back. Here the query
 * function reads a file on the device. It is already fresh, it cannot fail because of
 * connectivity, and it only changes when *this app* changes it: a local write
 * (`db/write.ts`) or a sync pull writing what it pulled. Both invalidate explicitly.
 *
 * So Query is used for what it is still the right tool for - deduping reads across
 * components, sharing one result, and re-rendering on invalidation - with every
 * time-based and focus-based behaviour switched off. The one trigger kept on is mount,
 * for the reason given on `refetchOnMount` below.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A local read fails only if the SQL is wrong, and retrying wrong SQL three
        // times just delays the stack trace.
        retry: false,
        // Nothing goes stale on a clock. Freshness is an event (a write, a sync), and
        // the code that causes the event invalidates the key.
        staleTime: Infinity,
        // `'always'`, not `false` (`TVO-36`, `CAT-18`). `invalidateQueries` re-runs only
        // *active* queries and merely marks inactive ones stale; `false` here declined to
        // act on the mark, so a screen unmounted when a write or a pull landed served its
        // old cache on return - Categories read `Groceries, 8 expenses` beside a Home that
        // showed seven. The read is a local SQLite query, so re-running it on mount costs
        // a few milliseconds, and the cache still paints first: no loading state.
        refetchOnMount: 'always',
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Local writes are transactional and either land or throw. A blind retry of a
        // write that already committed would queue the mutation a second time.
        retry: false,
      },
    },
  });
}
