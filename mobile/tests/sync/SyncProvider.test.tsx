import { act, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus, Text } from 'react-native';
import { SyncProvider, useSyncStatus, useSyncTriggers } from '@/sync/SyncProvider';
import type { SyncEngine, SyncStatus, SyncTrigger } from '@/sync/engine';

/**
 * The triggers, which are the half of sync the engine cannot see for itself.
 *
 * Driven over a stub engine rather than a real one on purpose: what is under test here is
 * *which events start a sync*, and a real engine would answer that question with a drain,
 * a pull and a server. The engine's own behaviour - ordering, single flight, failures - is
 * `tests/sync/engine.test.ts`.
 */

jest.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

const BackgroundTask = jest.requireMock('expo-background-task') as {
  registerTaskAsync: jest.Mock;
};

const IDLE: SyncStatus = {
  reachable: true,
  inFlight: false,
  lastAttemptFailed: false,
  pendingRecords: 0,
  lastSyncedAt: null,
  resyncing: false,
  resyncProgress: null,
  lastError: null,
};

interface StubEngine {
  readonly engine: SyncEngine;
  readonly triggers: SyncTrigger[];
  readonly starts: number[];
  readonly stops: number[];
  readonly pendingReads: number[];
  publish(patch: Partial<SyncStatus>): void;
}

function stubEngine(): StubEngine {
  const triggers: SyncTrigger[] = [];
  const starts: number[] = [];
  const stops: number[] = [];
  const pendingReads: number[] = [];
  const listeners = new Set<(status: SyncStatus) => void>();
  let status = IDLE;

  const stub: StubEngine = {
    triggers,
    starts,
    stops,
    pendingReads,
    publish(patch) {
      status = { ...status, ...patch };
      for (const listener of listeners) listener(status);
    },
    engine: {
      getStatus: () => status,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      sync: async (trigger) => {
        triggers.push(trigger);
        return { status: 'completed', trigger, push: null, pull: null, error: null };
      },
      start: async () => {
        starts.push(starts.length);
        // The real engine's `start` runs the first sync itself, under `app-open`.
        triggers.push('app-open');
      },
      stop: () => {
        stops.push(stops.length);
      },
      refreshPending: async () => {
        pendingReads.push(pendingReads.length);
      },
    },
  };

  return stub;
}

/** A consumer that reports the status and can fire the write trigger. */
function Consumer() {
  const status = useSyncStatus();
  const { onLocalWrite } = useSyncTriggers();

  return (
    <Text testID="status" onPress={onLocalWrite}>
      {`${status.pendingRecords} pending`}
    </Text>
  );
}

async function mountProvider(stub: StubEngine, enabled = true): Promise<void> {
  await render(
    <SyncProvider engine={stub.engine} enabled={enabled}>
      <Consumer />
    </SyncProvider>,
  );
}

/**
 * The `AppState` listener the provider takes, captured rather than emitted into.
 *
 * `AppState` has no `emit` in React Native 0.86 - it is a native event source, not an
 * `EventEmitter` a test can push through - so the subscription itself is the seam. This
 * also pins the event name: a provider that subscribed to something other than `change`
 * would capture nothing and fail here.
 */
let appState: ((next: AppStateStatus) => void) | null = null;
let subscriptions = 0;

beforeEach(() => {
  appState = null;
  subscriptions = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') {
      appState = handler as (next: AppStateStatus) => void;
      subscriptions += 1;
    }
    return {
      remove: () => {
        appState = null;
      },
    };
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

async function foreground(next: AppStateStatus): Promise<void> {
  await act(async () => {
    appState?.(next);
  });
}

describe('the triggers', () => {
  it('starts the engine on mount, which syncs on app open', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    expect(stub.starts).toHaveLength(1);
    expect(stub.triggers).toEqual(['app-open']);
  });

  /**
   * A phone that sat in a pocket for an hour has a stale cursor and possibly a queued
   * write. Returning to the foreground is the moment to fix that, rather than the next
   * time the user happens to type something.
   */
  it('syncs again when the app comes back to the foreground', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    await foreground('active');

    expect(stub.triggers).toEqual(['app-open', 'app-open']);
  });

  it('does not sync when the app merely goes away', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    await foreground('background');
    await foreground('inactive');

    expect(stub.triggers).toEqual(['app-open']);
  });

  it('syncs after a local write settles, and re-reads the pending count', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    await act(async () => {
      screen.getByTestId('status').props.onPress();
    });

    expect(stub.triggers).toEqual(['app-open', 'local-write']);
    expect(stub.pendingReads).toHaveLength(1);
  });

  it('hands the engine to the background task and asks to be woken', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledTimes(1);
    expect(stub.stops).toHaveLength(0);
  });

  it('drops the subscriptions when the tree goes away', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    await act(async () => {
      screen.unmount();
    });

    expect(stub.stops).toHaveLength(1);
  });
});

describe('with sync disabled', () => {
  it('starts nothing and syncs nothing', async () => {
    const stub = stubEngine();
    await mountProvider(stub, false);

    await foreground('active');

    expect(subscriptions).toBe(0);
    expect(stub.starts).toHaveLength(0);
    expect(stub.triggers).toEqual([]);
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });

  /**
   * The pending count is still re-read, because it is a local query and the pill has to
   * show a queued change on a device that will not reach a server for hours. Only the
   * network half is gated.
   */
  it('still re-reads the pending count after a write', async () => {
    const stub = stubEngine();
    await mountProvider(stub, false);

    await act(async () => {
      screen.getByTestId('status').props.onPress();
    });

    expect(stub.pendingReads).toHaveLength(1);
    expect(stub.triggers).toEqual([]);
  });
});

describe('the status it publishes', () => {
  it('re-renders consumers when the engine publishes', async () => {
    const stub = stubEngine();
    await mountProvider(stub);

    expect(screen.getByTestId('status')).toHaveTextContent('0 pending');

    await act(async () => {
      stub.publish({ pendingRecords: 2 });
    });

    expect(screen.getByTestId('status')).toHaveTextContent('2 pending');
  });
});
