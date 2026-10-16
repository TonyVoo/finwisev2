import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import { registerBackgroundSync, setBackgroundSyncEngine } from './background';
import type { SyncEngine, SyncStatus } from './engine';

/**
 * Mounts the sync engine into the tree, and owns every trigger that starts a sync.
 *
 * ### The four triggers, and where each one comes from
 *
 * | Trigger        | Source                                                            |
 * | -------------- | ----------------------------------------------------------------- |
 * | `app-open`     | `engine.start()` here, plus `AppState` returning to `active`       |
 * | `connectivity` | netinfo, inside the engine (`engine.ts`, `onReachabilityChange`)   |
 * | `local-write`  | `useLocalWrite`, through {@link useSyncTriggers}                   |
 * | `background`   | `expo-background-task`, through `background.ts`                   |
 *
 * They are deliberately not one subscription each to the same thing: `app-open` is a
 * lifecycle event, `connectivity` is a radio event, and `local-write` is a user action,
 * and an app that only had the first two would leave a change made in a tunnel sitting in
 * the outbox until the user quit and came back. The engine's single-flight guard is what
 * makes having four of them safe - a trigger that arrives mid-sync is remembered and runs
 * one more pass at the end rather than starting a second drain.
 *
 * ### Why `enabled` exists, and why it defaults to true
 *
 * Every screen in this app is specified to read and write local SQLite and touch nothing
 * else, and the screen suites enforce that with a transport that fails the test if it is
 * called. A provider that started syncing on mount would put a request on the wire in
 * every one of them - so `tests/support/mount.tsx` passes `startSync: false`.
 *
 * The default is `true` all the same: production correctness should not depend on a flag
 * someone remembered to pass, and the cost of the test helper opting out is one explicit
 * line in one file.
 */

export interface SyncContextValue {
  readonly engine: SyncEngine;
  readonly status: SyncStatus;
  /** Whether the triggers are wired. False in the screen suites; true in the app. */
  readonly enabled: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export interface SyncProviderProps {
  readonly engine: SyncEngine;
  readonly enabled?: boolean;
  readonly children: ReactNode;
}

export function SyncProvider({ engine, enabled = true, children }: SyncProviderProps) {
  const status = useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);

  useEffect(() => {
    if (!enabled) return;

    // `start()` takes the netinfo subscription, reads the persisted cursor and runs the
    // first sync. It is idempotent, so a re-mount does not re-run it.
    void engine.start();

    // Returning to the foreground is its own trigger. A phone that sat in a pocket for an
    // hour has a stale cursor and possibly a queued write, and the user's first frame
    // should be the moment that gets fixed rather than the next time they type something.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void engine.sync('app-open');
    });

    // Hand the engine to the task defined at module scope, so a wake-up that finds the
    // app resident runs *this* engine rather than building a second one against the same
    // outbox. Registration is best-effort and swallows its own failures.
    setBackgroundSyncEngine(engine);
    void registerBackgroundSync();

    return () => {
      appState.remove();
      setBackgroundSyncEngine(null);
      engine.stop();
    };
  }, [enabled, engine]);

  const value = useMemo<SyncContextValue>(
    () => ({ engine, status, enabled }),
    [enabled, engine, status],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/** The engine and its status, for the pill and the sheet. Throws outside the provider. */
export function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (value === null) {
    throw new Error('useSync must be used inside SyncProvider');
  }
  return value;
}

export function useSyncStatus(): SyncStatus {
  return useSync().status;
}

export interface SyncTriggers {
  /**
   * A local write has been committed and the reads have been invalidated.
   *
   * Two separate things happen, and only one of them is a sync. The pending count is
   * re-read unconditionally, because the pill has to show the new queued change even on a
   * device that will not reach a server for hours. The sync is attempted only when the
   * triggers are wired, and the engine then decides for itself whether the network is
   * worth trying (`engine.ts`: an unreachable device does not spend a radio wake-up to
   * learn what netinfo already said).
   *
   * Neither is awaited by the caller. A save must not wait on a push - the local write is
   * the confirmation (`docs/design/02-offline-and-sync.md` §1), and a form that awaited
   * the server would reintroduce exactly the blocking the architecture exists to avoid.
   */
  readonly onLocalWrite: () => void;
}

/**
 * The write path's view of sync: one function, and a no-op outside the provider.
 *
 * Optional rather than throwing, because `useLocalWrite` is used by screens that are
 * mounted without a sync provider in several suites, and a local write is complete and
 * correct without one. The sync is an afterthought to the write by design.
 */
export function useSyncTriggers(): SyncTriggers {
  const value = useContext(SyncContext);

  return useMemo<SyncTriggers>(
    () => ({
      onLocalWrite: () => {
        if (value === null) return;
        void value.engine.refreshPending();
        if (value.enabled) void value.engine.sync('local-write');
      },
    }),
    [value],
  );
}
