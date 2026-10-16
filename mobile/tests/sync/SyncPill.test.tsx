import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SYNCING_VISIBLE_AFTER_MS, SyncPill } from '@/sync/SyncPill';
import type { SyncInputs } from '@/sync/state';

/**
 * All six rows of `docs/design/02-offline-and-sync.md` §3, driven by the four inputs.
 *
 * The pill is the only place the app talks about connectivity, and the pair of states it
 * most needs to keep apart - **4 `Offline`**, grey and expected, against **6
 * `Sync failed`**, red and broken - differ by one input and by nothing the user can see
 * except the copy and the colour. So each row is asserted on its label, its spoken label
 * and whether it can be tapped, rather than on a state name the component chose.
 */

function inputs(overrides: Partial<SyncInputs> = {}): SyncInputs {
  return {
    reachable: true,
    inFlight: false,
    lastAttemptFailed: false,
    pendingRecords: 0,
    ...overrides,
  };
}

async function renderPill(
  state: Partial<SyncInputs>,
  onPress: () => void = () => undefined,
): Promise<void> {
  // `render` is async in RNTL 14: the tree is not queryable until it resolves.
  await render(<SyncPill inputs={inputs(state)} onPress={onPress} />);
}

function pillLabel(): string | undefined {
  return screen.getByTestId('sync-pill').props.accessibilityLabel as string | undefined;
}

beforeEach(() => {
  // The glyph asks for Reduce Motion on mount; left unmocked it resolves after the
  // assertions and updates state outside `act`.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the six states of the pill', () => {
  it('1 - renders nothing at all when online with an empty outbox', async () => {
    await renderPill({});

    // Not an empty pill, not a tick (rule 1) - and no pill to query.
    expect(screen.queryByTestId('sync-pill')).toBeNull();
    // The slot survives, so the title cannot move when the state changes (rule 7), and it
    // is hidden from the accessibility tree (rule 6) - hence the explicit include here.
    expect(screen.getByTestId('sync-pill-empty', { includeHiddenElements: true })).toBeTruthy();
  });

  it('3 - counts the pending records', async () => {
    await renderPill({ pendingRecords: 3 });

    expect(screen.getByText('3 pending')).toBeTruthy();
    expect(pillLabel()).toBe('3 changes waiting to sync. Double tap for details.');
  });

  it('3 - keeps the singular singular at exactly one record', async () => {
    await renderPill({ pendingRecords: 1 });

    // Rule 5: never `1 pendings`, and never `1 changes` read aloud.
    expect(screen.getByText('1 pending')).toBeTruthy();
    expect(pillLabel()).toBe('1 change waiting to sync. Double tap for details.');
  });

  it('4 - says Offline without apologising for it', async () => {
    await renderPill({ reachable: false });

    expect(screen.getByText('Offline')).toBeTruthy();
    expect(pillLabel()).toBe(
      'Offline. Your changes are saved on this device. Double tap for details.',
    );
  });

  it('5 - carries the count while unreachable', async () => {
    await renderPill({ reachable: false, pendingRecords: 2 });

    expect(screen.getByText('Offline · 2 pending')).toBeTruthy();
    expect(pillLabel()).toBe('Offline, 2 changes waiting to sync. Double tap for details.');
  });

  it('5 - keeps that singular singular too', async () => {
    await renderPill({ reachable: false, pendingRecords: 1 });

    expect(screen.getByText('Offline · 1 pending')).toBeTruthy();
    expect(pillLabel()).toBe('Offline, 1 change waiting to sync. Double tap for details.');
  });

  it('6 - reports a failure only while the device is online', async () => {
    await renderPill({ lastAttemptFailed: true });
    expect(screen.getByText('Sync failed')).toBeTruthy();
    expect(pillLabel()).toBe('Sync failed. Double tap for details.');
  });

  /**
   * `SYNC-58`, and the reason the engine keeps four inputs instead of a success boolean.
   * A push that failed a moment ago says nothing about a device that is now in a tunnel,
   * and `Sync failed` is the most misleading thing this pill can say about one.
   */
  it('shows Offline, not Sync failed, when a failure is followed by going offline', async () => {
    await renderPill({ reachable: false, lastAttemptFailed: true });

    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Sync failed')).toBeNull();
  });
});

describe('tappability', () => {
  it.each([
    ['3 - pending', { pendingRecords: 1 }],
    ['4 - offline', { reachable: false }],
    ['5 - offline and pending', { reachable: false, pendingRecords: 1 }],
    ['6 - error', { lastAttemptFailed: true }],
  ])('opens the sheet from state %s', async (_name, state: Partial<SyncInputs>) => {
    const onPress = jest.fn();
    await renderPill(state, onPress);

    expect(screen.getByTestId('sync-pill').props.accessibilityRole).toBe('button');

    // Awaited: RNTL 14's `render` is itself async and holds an `act` scope, and a
    // synchronous `act` here overlaps it - which tears down the tree the *next* case
    // renders into.
    await act(async () => {
      fireEvent.press(screen.getByTestId('sync-pill'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not a button in the syncing state', async () => {
    await renderPill({ inFlight: true, pendingRecords: 0 });

    // Past the suppression window, so the syncing pill is actually on screen.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SYNCING_VISIBLE_AFTER_MS + 10));
    });

    expect(screen.getByText('Syncing…')).toBeTruthy();
    expect(screen.getByTestId('sync-pill').props.accessibilityRole).toBeUndefined();
    expect(pillLabel()).toBe('Syncing your changes.');
  });
});

describe('the 800ms suppression of Syncing…', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  it('renders nothing for a sync that finishes quickly', async () => {
    await renderPill({ inFlight: true });

    await advance(SYNCING_VISIBLE_AFTER_MS - 1);

    // Rule 2: most syncs are faster than this, and a pill that flickers on every write is
    // worse than one that never appears.
    expect(screen.queryByTestId('sync-pill')).toBeNull();

    await advance(1);
    expect(screen.getByText('Syncing…')).toBeTruthy();
  });

  /**
   * The half of rule 2 that is easy to get wrong: suppressing `Syncing…` must not blank a
   * pill that was already saying something. A device with three queued changes keeps
   * reading `3 pending` while the push gets going.
   */
  it('keeps showing the pending count while suppressed', async () => {
    await renderPill({ inFlight: true, pendingRecords: 3 });

    expect(screen.getByText('3 pending')).toBeTruthy();

    await advance(SYNCING_VISIBLE_AFTER_MS);
    expect(screen.getByText('Syncing…')).toBeTruthy();
    expect(screen.queryByText('3 pending')).toBeNull();
  });
});
