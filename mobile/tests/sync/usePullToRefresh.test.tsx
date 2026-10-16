import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SyncProvider } from '@/sync/SyncProvider';
import type { SyncEngine, SyncRunResult, SyncStatus, SyncTrigger } from '@/sync/engine';
import { usePullToRefresh } from '@/sync/usePullToRefresh';

/**
 * Pull-to-refresh, over a stub engine.
 *
 * What is under test is the contract between the gesture and the engine - which trigger a
 * pull sends, and how long the spinner is allowed to spin - so the engine is a stub whose
 * `sync` the test resolves by hand. A real one would answer those questions with a drain,
 * a pull and a server, none of which this is about; the end-to-end wiring is
 * `tests/screens/pullToRefresh.test.tsx`.
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
  /** Every trigger `sync` was called with, in order. */
  readonly triggers: SyncTrigger[];
  /** Resolve the sync the pull is waiting on. Not wrapped in `act` - callers decide. */
  settle(): void;
}

/** An engine whose syncs hang until the test lets them finish. */
function stubEngine(): StubEngine {
  const triggers: SyncTrigger[] = [];
  const waiting: Array<(result: SyncRunResult) => void> = [];

  return {
    triggers,

    settle() {
      for (const resolve of waiting.splice(0, waiting.length)) {
        resolve({
          status: 'completed',
          trigger: 'pull-to-refresh',
          push: null,
          pull: null,
          error: null,
        });
      }
    },

    engine: {
      getStatus: () => IDLE,
      subscribe: () => () => undefined,
      sync: async (trigger) => {
        triggers.push(trigger);
        // `start()` runs its own `app-open` sync, which must not hang the mount.
        if (trigger === 'app-open') {
          return { status: 'completed', trigger, push: null, pull: null, error: null };
        }
        return await new Promise<SyncRunResult>((resolve) => waiting.push(resolve));
      },
      start: async () => undefined,
      stop: () => undefined,
      refreshPending: async () => undefined,
    },
  };
}

/** The spinner, and the gesture that starts it. */
function Consumer() {
  const { refreshing, onRefresh } = usePullToRefresh();

  return (
    <Text testID="refresh" onPress={onRefresh}>
      {refreshing ? 'spinning' : 'at rest'}
    </Text>
  );
}

async function mountConsumer(stub: StubEngine, enabled = true): Promise<void> {
  await render(
    <SyncProvider engine={stub.engine} enabled={enabled}>
      <Consumer />
    </SyncProvider>,
  );
}

async function pull(): Promise<void> {
  await act(async () => {
    screen.getByTestId('refresh').props.onPress();
  });
}

/** Let the in-flight sync finish, and the render it causes land. */
async function settle(stub: StubEngine): Promise<void> {
  await act(async () => {
    stub.settle();
  });
}

function spinner(): string {
  return screen.getByTestId('refresh').props.children as string;
}

describe('pull-to-refresh', () => {
  it('starts at rest - the spinner belongs to the gesture, not to the engine', async () => {
    const stub = stubEngine();
    await mountConsumer(stub);

    // The engine syncs on mount (`app-open`). If the spinner read `inFlight` it would be
    // turning right now, on a screen nobody has touched.
    expect(spinner()).toBe('at rest');
  });

  /**
   * Not `manual`. `manual` is the one trigger that overrides the engine's unreachable
   * skip, and rule 12 is explicit that an offline pull stops immediately and shows no
   * error - which is that skip. Sending `manual` here would put a request on the radio of
   * a device netinfo has already said is unreachable.
   */
  it('asks for a sync under its own trigger', async () => {
    const stub = stubEngine();
    await mountConsumer(stub);

    await pull();

    expect(stub.triggers).toEqual(['pull-to-refresh']);
    expect(stub.triggers).not.toContain('manual');
  });

  it('spins for exactly as long as the attempt lasts', async () => {
    const stub = stubEngine();
    await mountConsumer(stub);

    await pull();
    expect(spinner()).toBe('spinning');

    await settle(stub);
    expect(spinner()).toBe('at rest');
  });

  /**
   * A pull that lands mid-sync joins the running one (`engine.ts`'s single-flight guard
   * returns its promise), so the spinner has to stay up until *that* finishes rather than
   * resolving on its own. One settle clears both.
   */
  it('keeps spinning while a second pull joins the first', async () => {
    const stub = stubEngine();
    await mountConsumer(stub);

    await pull();
    await pull();
    expect(spinner()).toBe('spinning');

    await settle(stub);
    expect(spinner()).toBe('at rest');
    expect(stub.triggers).toEqual(['pull-to-refresh', 'pull-to-refresh']);
  });

  it('puts nothing on the wire when the triggers are unwired', async () => {
    const stub = stubEngine();
    await mountConsumer(stub, false);

    await pull();

    expect(stub.triggers).toEqual([]);
    expect(spinner()).toBe('at rest');
  });

  /**
   * The user can leave the tab while the sync is still in flight, and the answer then
   * lands on a screen that no longer exists.
   *
   * React 19 does not warn about that - the stray update is simply dropped - so what this
   * case can honestly pin is that the resolution is harmless rather than that it is
   * silent. The `mounted` guard in the hook is what keeps it so if the renderer's
   * tolerance ever changes back.
   */
  it('survives the answer arriving after the screen has gone', async () => {
    const stub = stubEngine();
    await mountConsumer(stub);
    await pull();

    await act(async () => {
      screen.unmount();
    });

    await expect(settle(stub)).resolves.toBeUndefined();
  });
});
