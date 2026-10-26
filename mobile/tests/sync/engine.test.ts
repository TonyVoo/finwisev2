import type { SyncPushResponse } from '@expense-tracker/shared';
import { applyLocalMutation } from '@/db/write';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryReachability, type MemoryReachability } from '@/sync/reachability';
import { readOutboxBatch } from '@/sync/outbox';
import { syncPillState } from '@/sync/state';
import type { TestDatabase } from '../support/sqlite';
import {
  categoryId,
  createFakeSyncApi,
  createSyncDatabase,
  pullPage,
  type FakeSyncApi,
} from '../support/sync';

/**
 * The engine: ordering, the single-flight guard, and the four inputs the pill reads.
 */

const CAT_1 = categoryId(1);
const AT = new Date('2026-10-15T10:00:00.000Z');

let database: TestDatabase;
let api: FakeSyncApi;
let reachability: MemoryReachability;

beforeEach(async () => {
  database = await createSyncDatabase();
  api = createFakeSyncApi();
  reachability = createMemoryReachability(true);
});

afterEach(() => {
  database.close();
});

function createEngine(onLocalDataChanged?: () => void): SyncEngine {
  return createSyncEngine({
    database,
    api,
    reachability,
    session: { getEpoch: () => 0 },
    clock: () => AT,
    ...(onLocalDataChanged === undefined ? {} : { onLocalDataChanged }),
  });
}

async function queueOne(name = 'Groceries'): Promise<void> {
  await applyLocalMutation(
    database,
    { entity: 'category', id: CAT_1, fields: { name, color: '#4f8a4f' } },
    { clock: () => AT },
  );
}

/**
 * Hold the *first* push open until the test lets it go, then answer normally.
 *
 * Only the first, because the cases below are about what the engine does while one
 * sync is in flight - a gate that caught every push would deadlock the extra pass the
 * second case is there to observe.
 */
function blockingFirstPush(): { release: () => void; entered: Promise<void> } {
  const answer = api.pushHandler;
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;

  api.pushHandler = async (body, call): Promise<SyncPushResponse> => {
    if (!held) {
      held = true;
      enter();
      await gate;
    }
    return await answer(body, call);
  };

  return { release, entered };
}

describe('ordering', () => {
  it('drains the outbox before it pulls', async () => {
    const order: string[] = [];
    await queueOne();
    const defaultPush = api.pushHandler;
    api.pushHandler = (body, call) => {
      order.push('push');
      return defaultPush(body, call);
    };
    api.pullHandler = () => {
      order.push('pull');
      return pullPage();
    };

    await createEngine().sync('app-open');

    // Not an optimisation: `resyncRequired` wipes the store, and that is only safe once
    // the outbox is empty (`02-offline-and-sync.md` §5.3).
    expect(order).toEqual(['push', 'pull']);
  });
});

describe('one sync at a time', () => {
  it('joins a running sync instead of starting a second', async () => {
    await queueOne();
    const engine = createEngine();
    const push = blockingFirstPush();

    const first = engine.sync('app-open');
    await push.entered;
    const second = engine.sync('local-write');
    push.release();
    await Promise.all([first, second]);

    // Two concurrent drains would read the same entries and push them twice; the second
    // response would then write back a row the first had already superseded.
    expect(api.pushes).toHaveLength(1);
  });

  it('runs one more pass for a trigger that arrived mid-sync', async () => {
    await queueOne('First');
    const engine = createEngine();
    const push = blockingFirstPush();

    const first = engine.sync('app-open');
    await push.entered;

    // A write lands while the drain is in flight. It must not be stranded until
    // something else happens to prod the engine.
    await applyLocalMutation(
      database,
      { entity: 'category', id: categoryId(2), fields: { name: 'Second', color: '#4f8a4f' } },
      { clock: () => AT },
    );
    void engine.sync('local-write');
    push.release();
    await first;

    expect(api.pushes).toHaveLength(2);
    expect(api.pushes[1]?.changes.map((change) => change.id)).toEqual([categoryId(2)]);
    expect(await readOutboxBatch(database)).toHaveLength(0);
  });
});

describe('reachability', () => {
  it('skips a sync that cannot reach anything', async () => {
    reachability.set(false);
    await queueOne();

    const result = await createEngine().sync('local-write');

    expect(result.status).toBe('skipped');
    expect(api.pushes).toHaveLength(0);
  });

  it('still attempts the sync the user asked for by name', async () => {
    reachability.set(false);
    await queueOne();

    const result = await createEngine().sync('manual');

    expect(result.status).toBe('completed');
    expect(api.pushes).toHaveLength(1);
  });

  /**
   * A pull is a user action too, but it is not the exception. Rule 12 of
   * `docs/design/04-expense-list.md` says an offline pull stops immediately and shows no
   * error, which is this skip; `manual` exists for `Try again`, which only appears in the
   * state where the app did reach a server.
   */
  it('skips a pull-to-refresh on an unreachable device', async () => {
    reachability.set(false);
    await queueOne();

    const result = await createEngine().sync('pull-to-refresh');

    expect(result.status).toBe('skipped');
    expect(api.pushes).toHaveLength(0);
    expect(api.pulls).toHaveLength(0);
  });

  it('syncs when connectivity comes back', async () => {
    reachability.set(false);
    const engine = createEngine();
    await engine.start();
    expect(api.pushes).toHaveLength(0);

    await queueOne();
    reachability.set(true);
    // The listener fires synchronously and starts the sync; let it settle.
    await engine.sync('app-open');

    expect(api.pushes).toHaveLength(1);
  });

  it('clears a recorded failure when the radio drops', async () => {
    api.pushHandler = () => {
      throw new Error('Network request failed');
    };
    await queueOne();
    const engine = createEngine();
    await engine.start();

    expect(engine.getStatus()).toMatchObject({ lastAttemptFailed: true, reachable: true });
    expect(syncPillState(engine.getStatus())).toBe('error');

    reachability.set(false);

    // The failure happened while online and says nothing about a device now in a tunnel.
    expect(engine.getStatus().lastAttemptFailed).toBe(false);
    expect(syncPillState(engine.getStatus())).toBe('offline-pending');
  });
});

describe('failures never reach the UI', () => {
  it('returns a failed result rather than throwing, and keeps the change queued', async () => {
    api.pullHandler = () => {
      throw new Error('500 internal_error');
    };
    await queueOne();
    const engine = createEngine();

    const result = await engine.sync('app-open');

    expect(result.status).toBe('failed');
    expect(engine.getStatus()).toMatchObject({
      inFlight: false,
      lastAttemptFailed: true,
      lastError: '500 internal_error',
    });
    // The push went through before the pull failed, so the local store is further along
    // than it was and nothing is corrupt.
    expect(await readOutboxBatch(database)).toHaveLength(0);
  });
});

describe('status the pill reads', () => {
  it('counts distinct pending records, not outbox entries', async () => {
    await queueOne('Groceries');
    await applyLocalMutation(
      database,
      { entity: 'category', id: CAT_1, fields: { name: 'Food' } },
      { clock: () => AT },
    );
    api.pushHandler = () => {
      throw new Error('offline');
    };

    const engine = createEngine();
    await engine.sync('app-open');

    // Three edits to one expense read as `1 pending` (§3 rule 5).
    expect(await readOutboxBatch(database)).toHaveLength(2);
    expect(engine.getStatus().pendingRecords).toBe(1);
  });

  it('records when the sync completed, and tells the caller local rows moved', async () => {
    const changed = jest.fn();
    await queueOne();
    const engine = createEngine(changed);

    await engine.sync('app-open');

    expect(engine.getStatus().lastSyncedAt).toBe(AT.toISOString());
    expect(changed).toHaveBeenCalledTimes(1);
    expect(syncPillState(engine.getStatus())).toBe('idle');
  });

  it('does not invalidate reads when nothing changed', async () => {
    const changed = jest.fn();
    const engine = createEngine(changed);

    await engine.sync('app-open');

    expect(changed).not.toHaveBeenCalled();
  });
});
