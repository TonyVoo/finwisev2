import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * Whether the network is believed to be usable.
 *
 * This is a port, not a wrapper for tidiness. Two things depend on it being substitutable:
 * the sync engine's tests, which have no native modules under jest, and the honesty of
 * what it reports - the app distinguishes "unreachable" from "a request failed"
 * (`state.ts`), and that distinction only exists if something other than request
 * outcomes answers the question.
 *
 * ### What counts as reachable
 *
 * `NetInfoState` carries two answers and they disagree usefully. `isConnected` is "there
 * is an interface up"; `isInternetReachable` is "something answered when we checked".
 * The rule here:
 *
 * - `isConnected === false` → unreachable. No interface, no request worth making.
 * - `isInternetReachable === false` → unreachable. Connected to a captive portal or a
 *   router with no uplink, which is the case a connectivity check exists to catch.
 * - `isInternetReachable === null` → **reachable**. Null means not yet determined, and
 *   the optimistic reading is the right one: the cost of trying and failing is one
 *   request that the pill reports as state 6 for a moment, while the cost of assuming
 *   unreachable is an app that will not sync until something else prods it.
 */

export type ReachabilityListener = (reachable: boolean) => void;

export interface Reachability {
  /** The last known answer. Synchronous, so the pill can render it on the first frame. */
  current(): boolean;
  /** Returns an unsubscribe function. The listener fires only on a change. */
  subscribe(listener: ReachabilityListener): () => void;
  /** Ask the platform again. Used on app open, where the cached answer may be stale. */
  refresh(): Promise<boolean>;
}

export function isStateReachable(state: NetInfoState): boolean {
  if (state.isConnected === false) return false;
  return state.isInternetReachable !== false;
}

/**
 * A {@link Reachability} over `@react-native-community/netinfo`.
 *
 * The subscription is taken once, at construction, because netinfo's listener is also
 * how it keeps its own state fresh - `fetch()` alone would leave the app asking a cache
 * nobody is updating.
 */
export function createNetInfoReachability(): Reachability {
  // Optimistic until told otherwise, for the same reason `null` reads as reachable: the
  // first sync of a cold start should not wait for a connectivity probe to come back.
  let reachable = true;
  const listeners = new Set<ReachabilityListener>();

  function publish(next: boolean): void {
    if (next === reachable) return;
    reachable = next;
    for (const listener of listeners) listener(next);
  }

  NetInfo.addEventListener((state) => {
    publish(isStateReachable(state));
  });

  return {
    current: () => reachable,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      publish(isStateReachable(await NetInfo.fetch()));
      return reachable;
    },
  };
}

/** An in-memory {@link Reachability} for tests and for the web preview target. */
export interface MemoryReachability extends Reachability {
  set(reachable: boolean): void;
}

export function createMemoryReachability(initial = true): MemoryReachability {
  let reachable = initial;
  const listeners = new Set<ReachabilityListener>();

  return {
    current: () => reachable,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: async () => reachable,
    set(next: boolean) {
      if (next === reachable) return;
      reachable = next;
      for (const listener of listeners) listener(next);
    },
  };
}
