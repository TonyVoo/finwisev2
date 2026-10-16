import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { ResyncOverlay } from '@/sync/ResyncOverlay';
import { SyncProvider } from '@/sync/SyncProvider';
import type { SyncEngine, SyncStatus } from '@/sync/engine';

/**
 * `Catching up` - the only full-screen blocking state in the app (§5.3).
 *
 * The cases worth having are about *when* it is on screen, because this overlay covers
 * the tab bar and is not dismissible: appearing when it should not would lock the user
 * out of an app whose whole promise is that it works without a server.
 */

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

function stubEngine(): { engine: SyncEngine; publish: (patch: Partial<SyncStatus>) => void } {
  const listeners = new Set<(status: SyncStatus) => void>();
  let status = IDLE;

  return {
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
      sync: async (trigger) => ({
        status: 'completed',
        trigger,
        push: null,
        pull: null,
        error: null,
      }),
      start: async () => undefined,
      stop: () => undefined,
      refreshPending: async () => undefined,
    },
  };
}

async function mountOverlay(engine: SyncEngine): Promise<void> {
  // `enabled: false` - this is about what the overlay renders, not about triggers.
  await render(
    <SyncProvider engine={engine} enabled={false}>
      <ResyncOverlay />
    </SyncProvider>,
  );
}

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the Catching up overlay', () => {
  it('is absent in every ordinary state, including an ordinary sync', async () => {
    const stub = stubEngine();
    await mountOverlay(stub.engine);

    expect(screen.queryByTestId('resync-overlay')).toBeNull();

    await act(async () => {
      stub.publish({ inFlight: true, pendingRecords: 3 });
    });

    // An ordinary sync is the pill's business. Blocking the app for one would make every
    // push a modal.
    expect(screen.queryByTestId('resync-overlay')).toBeNull();
  });

  it('takes the screen while the local store is being rebuilt', async () => {
    const stub = stubEngine();
    await mountOverlay(stub.engine);

    await act(async () => {
      stub.publish({
        inFlight: true,
        resyncing: true,
        resyncProgress: { pages: 2, changes: 400, hasMore: true, resyncing: true },
      });
    });

    expect(screen.getByTestId('resync-overlay')).toBeTruthy();
    expect(screen.getByText('Catching up')).toBeTruthy();
    expect(
      screen.getByText(
        'You have not used the app in a while, so we are refreshing your expenses from scratch. This only takes a moment.',
      ),
    ).toBeTruthy();
    // Watching real pages rather than a timer.
    expect(screen.getByTestId('resync-progress-2')).toBeTruthy();
  });

  it('never uses the words the mechanism is written in', async () => {
    const stub = stubEngine();
    await mountOverlay(stub.engine);

    await act(async () => {
      stub.publish({ resyncing: true });
    });

    // §5.3: the user's mental model is "my expenses"; the mechanism is not their problem.
    for (const word of ['resync', 'cursor', 'horizon', 'wiped']) {
      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull();
    }
  });

  it('announces itself, and announces again when it goes away', async () => {
    const stub = stubEngine();
    await mountOverlay(stub.engine);

    const announce = AccessibilityInfo.announceForAccessibility as jest.Mock;

    await act(async () => {
      stub.publish({ resyncing: true });
    });
    const onAppear = announce.mock.calls.length;
    expect(onAppear).toBeGreaterThanOrEqual(1);
    expect(announce).toHaveBeenCalledWith('Catching up');

    await act(async () => {
      stub.publish({ resyncing: false });
    });

    expect(screen.queryByTestId('resync-overlay')).toBeNull();
    // Asserted as "more than before" rather than an exact count: React's development
    // build mounts effects twice, so a literal number here would be pinning the dev
    // double-invoke rather than the behaviour.
    expect(announce.mock.calls.length).toBeGreaterThan(onAppear);
    expect(announce.mock.calls.every(([message]) => message === 'Catching up')).toBe(true);
  });
});
