import type { ApiClient } from '../api/client';
import { type Clock, systemClock, toTimestamp } from '../lib/clock';
import { countPendingRecords } from '../db/queries';
import type { SqliteDatabase } from '../db/sqlite';
import { readLastSyncedAt, writeLastSyncedAt } from './cursor';
import { type PullOutcome, type PullProgress, pullChanges } from './pull';
import { type PushOutcome, drainOutbox } from './push';
import type { Reachability } from './reachability';
import type { SyncInputs } from './state';

/**
 * The sync engine: drain the outbox, then pull, and tell the UI what state that leaves
 * the app in.
 *
 * ### Push before pull, always
 *
 * Not an optimisation. The pull can be told to `resyncRequired`, which wipes the local
 * store, and that is only safe once the outbox is empty
 * (`docs/design/02-offline-and-sync.md` §5.3). Draining first is what makes the common
 * case of that wipe safe; `pull.ts` refuses to wipe if the drain did not finish, which
 * is what makes the uncommon case safe.
 *
 * ### One sync at a time
 *
 * Every trigger funnels through {@link SyncEngine.sync}, and a trigger that arrives
 * while a sync is running does not start a second one - two concurrent drains would
 * read the same outbox entries and push them twice, and while `clientMutationId` makes
 * the *server* side of that harmless, the second response would write back a row the
 * first had already superseded. Instead the trigger is remembered and one more pass runs
 * when the current one finishes, so a write that lands mid-sync is never stranded until
 * something else happens to prod the engine.
 *
 * ### Nothing in here throws at the UI
 *
 * A failed sync returns a result; it never rejects. The local store is the source of
 * truth and stays usable, the queued change is retried later, and the only visible
 * consequence is the pill. "Sync failures never block or corrupt the UI" is an
 * acceptance criterion, and the way to keep it is for the failure path to have no way
 * to reach a screen.
 */

export type SyncTrigger =
  /** The app came to the foreground, or was launched. */
  | 'app-open'
  /** netinfo reported the network usable again. */
  | 'connectivity'
  /** A local write settled. */
  | 'local-write'
  /** `expo-background-task` woke us. Best-effort; may never fire. */
  | 'background'
  /** The user tapped `Try again` in the sync sheet. */
  | 'manual';

export interface SyncStatus extends SyncInputs {
  /** ISO-8601, or null when this install has never completed a sync. */
  readonly lastSyncedAt: string | null;
  /** True while a `resyncRequired` full download is in progress (§5.3's blocking screen). */
  readonly resyncing: boolean;
  /** Pages and rows applied so far by the running resync, for its progress bar. */
  readonly resyncProgress: PullProgress | null;
  /** Message from the last failure, for the sheet's error section. Not user copy. */
  readonly lastError: string | null;
}

export type SyncRunStatus = 'completed' | 'skipped' | 'failed';

export interface SyncRunResult {
  readonly status: SyncRunStatus;
  readonly trigger: SyncTrigger;
  readonly push: PushOutcome | null;
  readonly pull: PullOutcome | null;
  readonly error: unknown;
}

export interface SyncEngineDependencies {
  readonly database: SqliteDatabase;
  readonly api: Pick<ApiClient, 'pushSync' | 'pullSync'>;
  readonly reachability: Reachability;
  readonly clock?: Clock;
  /**
   * Called after a sync that changed local rows, so the caller can invalidate its
   * reads. Separate from the status subscription because the two have different
   * audiences: this one re-runs SQLite queries, that one re-renders a pill.
   */
  readonly onLocalDataChanged?: () => void;
}

export interface SyncEngine {
  getStatus(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  /** Run a sync, or join the one already running. Never rejects. */
  sync(trigger: SyncTrigger): Promise<SyncRunResult>;
  /** Subscribe to connectivity and run the first sync. Idempotent. */
  start(): Promise<void>;
  /** Drop the connectivity subscription. A sync already in flight is left to finish. */
  stop(): void;
  /** Re-read the pending count, e.g. right after a local write. */
  refreshPending(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function changedLocalRows(push: PushOutcome | null, pull: PullOutcome | null): boolean {
  if (push !== null && push.applied + push.conflicted + push.rejected > 0) return true;
  return pull !== null && (pull.changes > 0 || pull.resynced);
}

export function createSyncEngine(deps: SyncEngineDependencies): SyncEngine {
  const { database, api, reachability, onLocalDataChanged } = deps;
  const clock = deps.clock ?? systemClock;

  let status: SyncStatus = {
    reachable: reachability.current(),
    inFlight: false,
    lastAttemptFailed: false,
    pendingRecords: 0,
    lastSyncedAt: null,
    resyncing: false,
    resyncProgress: null,
    lastError: null,
  };

  const listeners = new Set<(next: SyncStatus) => void>();
  let running: Promise<SyncRunResult> | null = null;
  let rerunRequested = false;
  let unsubscribeReachability: (() => void) | null = null;
  let started = false;

  function publish(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch };
    for (const listener of listeners) listener(status);
  }

  async function refreshPending(): Promise<void> {
    const pendingRecords = await countPendingRecords(database);
    if (pendingRecords !== status.pendingRecords) publish({ pendingRecords });
  }

  async function runOnce(trigger: SyncTrigger): Promise<SyncRunResult> {
    publish({ inFlight: true });
    let push: PushOutcome | null = null;
    let pull: PullOutcome | null = null;

    try {
      push = await drainOutbox({ database, api, clock });
      pull = await pullChanges({
        database,
        api,
        onProgress: (progress) =>
          publish({ resyncing: progress.resyncing, resyncProgress: progress }),
      });

      const at = toTimestamp(clock());
      await writeLastSyncedAt(database, at);
      publish({ lastAttemptFailed: false, lastError: null, lastSyncedAt: at });
      return { status: 'completed', trigger, push, pull, error: null };
    } catch (error) {
      // `lastAttemptFailed` is only true while the device believes it is online, which is
      // the literal condition for pill state 6 - "failed **while online**". Offline, the
      // failure carries no information the user needs and state 4 already says what is
      // happening.
      publish({ lastAttemptFailed: reachability.current(), lastError: messageOf(error) });
      return { status: 'failed', trigger, push, pull, error };
    } finally {
      publish({ inFlight: false, resyncing: false, resyncProgress: null });
      await refreshPending();
      if (changedLocalRows(push, pull)) onLocalDataChanged?.();
    }
  }

  async function sync(trigger: SyncTrigger): Promise<SyncRunResult> {
    if (running !== null) {
      rerunRequested = true;
      return await running;
    }

    // A sync that cannot reach anything is not attempted, except when the user asked for
    // it by name. Trying anyway would cost a radio wake-up to learn what netinfo already
    // said, and `Try again` only exists in the state where the app *did* reach a server
    // (§4 rule 1), so the exception cannot be used to retry into a void.
    if (!reachability.current() && trigger !== 'manual') {
      await refreshPending();
      return { status: 'skipped', trigger, push: null, pull: null, error: null };
    }

    rerunRequested = false;
    running = (async () => {
      let result = await runOnce(trigger);
      while (rerunRequested) {
        rerunRequested = false;
        result = await runOnce(trigger);
      }
      return result;
    })();

    try {
      return await running;
    } finally {
      running = null;
    }
  }

  function onReachabilityChange(reachable: boolean): void {
    if (!reachable) {
      // The transition that `SYNC-58` pins. A failure recorded a moment ago happened
      // while online and says nothing about a device that is now in a tunnel; leaving
      // the flag set renders `Sync failed` in red where the design demands a quiet grey
      // `Offline`, which §3 rule 3 is explicit is not an error.
      publish({ reachable: false, lastAttemptFailed: false, lastError: null });
      return;
    }

    publish({ reachable: true });
    void sync('connectivity');
  }

  return {
    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    sync,
    refreshPending,

    async start() {
      if (started) return;
      started = true;

      unsubscribeReachability = reachability.subscribe(onReachabilityChange);
      publish({ lastSyncedAt: await readLastSyncedAt(database) });
      await refreshPending();
      // The cached netinfo answer can predate the launch, so it is re-asked before the
      // first sync decides whether to run at all.
      publish({ reachable: await reachability.refresh() });
      await sync('app-open');
    },

    stop() {
      unsubscribeReachability?.();
      unsubscribeReachability = null;
      started = false;
    },
  };
}
