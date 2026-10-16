import {
  type SyncInputs,
  type SyncPillState,
  isPillTappable,
  syncPillState,
} from '@/sync/state';

/**
 * `docs/design/02-offline-and-sync.md` §3's table, as a table.
 *
 * The case worth reading is the last one. `SYNC-32` drives each of the six states from
 * a clean start, so a failure flag left over from a moment ago never gets the chance to
 * show and all six go green over an app that renders `Sync failed` at a user standing in
 * a tunnel. A state machine only tested from clean states is not tested.
 */

const BASE: SyncInputs = {
  reachable: true,
  inFlight: false,
  lastAttemptFailed: false,
  pendingRecords: 0,
};

describe('the six pill states', () => {
  it.each([
    ['1 idle', {}, 'idle'],
    ['2 syncing', { inFlight: true }, 'syncing'],
    ['3 pending', { pendingRecords: 3 }, 'pending'],
    ['4 offline', { reachable: false }, 'offline'],
    ['5 offline + pending', { reachable: false, pendingRecords: 2 }, 'offline-pending'],
    ['6 error', { lastAttemptFailed: true }, 'error'],
  ] as const)('%s', (_name, inputs, expected) => {
    expect(syncPillState({ ...BASE, ...inputs })).toBe(expected);
  });

  it('shows Syncing over everything else while a request is in flight', () => {
    expect(
      syncPillState({ ...BASE, inFlight: true, pendingRecords: 4, lastAttemptFailed: true }),
    ).toBe('syncing');
  });

  it('shows Offline, not Sync failed, when a failure is followed by losing the radio', () => {
    // State 6's condition is "failed **while online**", and §3 rule 3 says state 4 is not
    // an error and is never coloured as one. A device that just went offline must read
    // grey and quiet even if the last attempt did fail a moment earlier.
    expect(syncPillState({ ...BASE, reachable: false, lastAttemptFailed: true })).toBe('offline');
    expect(
      syncPillState({ ...BASE, reachable: false, lastAttemptFailed: true, pendingRecords: 1 }),
    ).toBe('offline-pending');
  });
});

describe('tappability', () => {
  it('opens the sheet from states 3 to 6 only', () => {
    const tappable: readonly SyncPillState[] = ['pending', 'offline', 'offline-pending', 'error'];
    const inert: readonly SyncPillState[] = ['idle', 'syncing'];

    expect(tappable.every(isPillTappable)).toBe(true);
    expect(inert.some(isPillTappable)).toBe(false);
  });
});
