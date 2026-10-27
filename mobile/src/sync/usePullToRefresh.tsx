import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useSync } from './SyncProvider';
import { useColors } from '../theme/ThemeProvider';

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
 * ### Why this returns two shapes rather than one
 *
 * `TVO-37`/`SYNC-61`. Because React Native has two refresh contracts and the choice of
 * which one applies is made by the *component*, not by this hook:
 *
 * - a `VirtualizedList` (`FlatList`, `SectionList`) takes `refreshing` and `onRefresh` and
 *   builds its own `RefreshControl`;
 * - a plain `ScrollView` takes a **built control** through `refreshControl`, and has
 *   neither of those props.
 *
 * This hook used to return only the first pair, and both tabs spread it. Home's
 * `SectionList` read it and worked; Summary's `ScrollView` silently dropped both props on
 * the floor and the gesture was inert there - no spinner, no sync, zero requests on the
 * wire. Neither shape is correct on its own, so both are returned under names that say
 * where each one goes, and the mismatch that caused the defect no longer type-checks into
 * place.
 *
 * The control is built here rather than left to each screen so the spec's silence on how
 * the spinner should *look* is answered in exactly one place - the platform default -
 * rather than invented twice.
 */

/** What a `VirtualizedList` takes: it builds the control itself. */
export interface PullToRefreshListProps {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

export interface PullToRefresh {
  /** Spread onto a `FlatList` or `SectionList`. */
  readonly listProps: PullToRefreshListProps;
  /** Passed to a plain `ScrollView` as its `refreshControl`. */
  readonly refreshControl: ReactElement<RefreshControlProps>;
}

export function usePullToRefresh(): PullToRefresh {
  const color = useColors();
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
    void engine.sync('pull-to-refresh').finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [enabled, engine]);

  const listProps = useMemo<PullToRefreshListProps>(
    () => ({ refreshing, onRefresh }),
    [refreshing, onRefresh],
  );

  // Rebuilt when `refreshing` flips, which is what drives the spinner on a `ScrollView`:
  // the element carries the flag, so a stale element would freeze the spinner on.
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={color.text.secondary}
        colors={[color.primary.default]}
        progressBackgroundColor={color.bg.surface}
      />
    ),
    [refreshing, onRefresh],
  );

  return { listProps, refreshControl };
}
