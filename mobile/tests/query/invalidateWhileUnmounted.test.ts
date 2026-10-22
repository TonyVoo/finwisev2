import { QueryObserver } from '@tanstack/react-query';
import { createQueryClient } from '@/query/client';
import { queryKeys } from '@/query/keys';

/**
 * `CAT-18`. An invalidation that lands while a screen is unmounted is lost, so the screen
 * shows its stale cache the next time the user navigates to it.
 *
 * Found on a device (21 Oct, Pixel 9 / API 36 / Expo Go): Home showed seven live Groceries
 * expenses and Settings > Categories showed `Groceries, 8 expenses` on the same device at
 * the same moment, the eighth having been swipe-deleted from Home a few seconds earlier.
 * The delete's `invalidateQueries({ queryKey: ['local'] })` ran while the Categories screen
 * was not mounted; navigating to it served the cached row.
 *
 * `07-categories.md` §1 rule 1 is explicit that the count is **live** - "`SELECT categoryId,
 * COUNT(*) FROM expenses WHERE deletedAt IS NULL GROUP BY categoryId`" - and the SQL in
 * `db/queries.ts` is correct. Nothing is wrong with the read; it is simply not re-run.
 *
 * ### Why this is the query client's case, and why there is no component in it
 *
 * `query/client.ts` turns off every refetch trigger - `staleTime: Infinity`,
 * `refetchOnMount: false`, `refetchOnReconnect: false`, `refetchOnWindowFocus: false` - on
 * the stated reasoning that "the code that causes the event invalidates the key". That
 * reasoning holds only for queries that are *mounted* when the event happens:
 * `invalidateQueries` refetches active queries and merely marks inactive ones, and
 * `refetchOnMount: false` is what then declines to act on the mark. Every screen in the app
 * inherits that default, so the defect belongs to the client rather than to any one screen.
 *
 * A `QueryObserver` subscription is what `useQuery` *is* - the hook is a React binding over
 * one of these, and the decision under test (refetch on mount, or serve the cache) is taken
 * in the observer, not in the renderer. Driving it directly keeps the case about the
 * configuration and off the testing library, and `subscribe`/`unsubscribe` map exactly onto
 * the mount and unmount the user performs by navigating.
 *
 * The bound matters as much as the defect, and it is what fixes the severity: the delete
 * **dialog** was right where the row was wrong, because `settings/categories.tsx` calls
 * `countCategoryExpenses` against SQLite when the dialog opens rather than reading the
 * cached row. So the number the user is asked to confirm against - "Its 7 expenses will
 * move to Uncategorized" - is computed fresh, and no expense is reassigned on a stale
 * count. This is a wrong number on a screen, not a wrong decision about data.
 *
 * `it.failing` until `TVO-36` lands.
 */

const KEY = queryKeys.categories.withCounts();

/** What `useQuery` does, without the renderer: observe, and record every read. */
function mount(client: ReturnType<typeof createQueryClient>, read: () => number) {
  const observer = new QueryObserver(client, {
    queryKey: KEY,
    queryFn: async () => read(),
  });
  const unsubscribe = observer.subscribe(() => undefined);
  return { observer, unmount: unsubscribe };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a query invalidated while nothing is observing it', () => {
  /**
   * The precondition, so the case below cannot pass by never having cached anything: the
   * same invalidation does re-run the read while the screen is mounted.
   */
  it('is refetched immediately while the screen is mounted', async () => {
    const client = createQueryClient();
    let live = 8;
    let reads = 0;
    const screen = mount(client, () => {
      reads += 1;
      return live;
    });
    await settled();
    expect(reads).toBe(1);
    expect(screen.observer.getCurrentResult().data).toBe(8);

    live = 7;
    await client.invalidateQueries({ queryKey: queryKeys.local() });

    expect(reads).toBe(2);
    expect(screen.observer.getCurrentResult().data).toBe(7);
    screen.unmount();
  });

  /**
   * `CAT-18`. The same invalidation, with the screen unmounted across it - which is what
   * navigating away from Settings, deleting an expense on Home, and navigating back does.
   */
  it.failing('is refetched when the screen is mounted again', async () => {
    const client = createQueryClient();
    let live = 8;
    let reads = 0;
    const read = () => {
      reads += 1;
      return live;
    };

    const first = mount(client, read);
    await settled();
    expect(reads).toBe(1);

    first.unmount();
    live = 7;
    await client.invalidateQueries({ queryKey: queryKeys.local() });

    const second = mount(client, read);
    await settled();

    expect(reads).toBe(2);
    expect(second.observer.getCurrentResult().data).toBe(7);
    second.unmount();
  });
});
