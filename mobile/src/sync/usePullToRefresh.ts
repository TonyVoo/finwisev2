import { useCallback, useEffect, useRef, useState } from 'react';
import { useSync } from './SyncProvider';

/**
 * Pull-to-refresh on Home and Summary: a sync, not a reload.
 *
 * `docs/design/04-expense-list.md` §Behaviour rule 12, which `08-monthly-summary.md`
 * rule 12 adopts unchanged. Three things about it are easy to build as something
 * plausible and wrong, so each is stated where it is decided:
 *
 * - **It does not re-read anything.** The list and the chart are already current - they
 *   are reads of local SQLite, invalidated by every local write - so there is nothing for
 *   a refresh to fetch. What the gesture asks for is a *sync*: drain the outbox, pull what
 *   other devices wrote. If the figures change afterwards it is because rows arrived, not
 *   because the screen re-queried.
 * - **The spinner is tied to the attempt**, not to the engine's `inFlight` flag. Reading
 *   the flag would make the spinner appear on its own whenever a background sync started,
 *   which is a control animating without being touched. Pulling while a sync is already
 *   running joins it instead of starting a second one - that is `engine.sync`'s
 *   single-flight guard, and the spinner correctly lasts until that one finishes.
 * - **Offline is not an error.** `engine.sync` skips an unreachable device for every
 *   trigger except `manual`, and returns rather than throwing, so the spinner stops on the
 *   next tick and the pill carries the whole explanation (§3 state 4). There is no banner,
 *   no toast and no blanked list, and the rows stay exactly as they were.
 *
 * Returned as the two props a scrollable takes rather than as a `RefreshControl` element,
 * so the list builds its own and the spec's silence on how the spinner should *look* is
 * not filled in with an invention.
 */

export interface PullToRefreshProps {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

export function usePullToRefresh(): PullToRefreshProps {
  const { engine, enabled } = useSync();
  const [refreshing, setRefreshing] = useState(false);

  // A pull is answered asynchronously, and the user can leave the tab before the answer
  // arrives. Without this the resolution lands on an unmounted screen.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    // The same gate `useSyncTriggers` applies to the local-write trigger: with the
    // triggers unwired there is no engine running, and a screen suite that pulls without
    // opting into sync should put nothing on the wire
    // (`tests/support/mount.tsx`: `startSync`).
    if (!enabled) return;

    setRefreshing(true);
    // `sync` never rejects (`engine.ts`), so this cannot leave the spinner stuck - but
    // `finally` rather than `then` so that stays true if that ever changes.
    void engine
      .sync('pull-to-refresh')
      .finally(() => {
        if (mounted.current) setRefreshing(false);
      });
  }, [enabled, engine]);

  return { refreshing, onRefresh };
}
