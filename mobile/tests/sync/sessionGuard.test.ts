import { createMemoryReachability } from '@/sync/reachability';
import { createSyncEngine } from '@/sync/engine';
import { drainOutbox } from '@/sync/push';
import { pullChanges } from '@/sync/pull';
import { INITIAL_CURSOR, readSyncCursor } from '@/sync/cursor';
import { readOutboxBatch } from '@/sync/outbox';
import { SessionChangedError, captureSession } from '@/sync/sessionGuard';
import { applyLocalMutation } from '@/db/write';
import type { TestDatabase } from '../support/sqlite';
import {
  categoryId,
  createFakeSyncApi,
  createSyncDatabase,
  pullPage,
  serverCategory,
} from '../support/sync';

/**
 * `TVO-20`, the half `authorizeSessionChange.test.ts` cannot see: a sync pass that
 * *spans* a session change, rather than a request whose 401 does.
 *
 * `AUTH-23`/`AUTH-24` pin the interceptor refusing to retry under another account's token.
 * But the push body is read from SQLite before the request is made and held in memory
 * across the await, so a user who logs out and a second who logs in while the first send
 * is still being prepared would have user A's rows go out under user B's token on the
 * *first* attempt, with no 401 and no retry for the interceptor to refuse. And the answer
 * - or a pulled page - would then be written into B's freshly wiped database.
 *
 * The session is a counter here, not a controller: what is under test is what a pass does
 * when the epoch moves, and the controller's half (it moves on every sign-in and sign-out,
 * before the wipe) is pinned in `tests/auth`.
 */

const CAT = categoryId(1);
const AT = new Date('2026-10-26T09:00:00.000Z');

let database: TestDatabase;
let epoch: number;
const session = { getEpoch: () => epoch };

beforeEach(async () => {
  database = await createSyncDatabase();
  epoch = 1;
});

afterEach(() => {
  database.close();
});

async function queueOne(): Promise<void> {
  await applyLocalMutation(
    database,
    { entity: 'category', id: CAT, fields: { name: 'Groceries', color: '#4f8a4f' } },
    { clock: () => AT },
  );
}

const switchUser = () => {
  epoch += 1;
};

describe('a push pass', () => {
  it('sends nothing, and touches nothing, when the session changed before the send', async () => {
    await queueOne();
    const api = createFakeSyncApi();
    const guard = captureSession(session);

    switchUser();

    await expect(drainOutbox({ database, api, clock: () => AT, guard })).rejects.toBeInstanceOf(
      SessionChangedError,
    );
    expect(api.pushes).toEqual([]);
    expect(await readOutboxBatch(database)).toHaveLength(1);
  });

  it('does not write the answer back when the session changed while it was away', async () => {
    await queueOne();
    const api = createFakeSyncApi();
    const answer = api.pushHandler;
    api.pushHandler = (body, call) => {
      switchUser();
      return answer(body, call);
    };

    await expect(
      drainOutbox({ database, api, clock: () => AT, guard: captureSession(session) }),
    ).rejects.toBeInstanceOf(SessionChangedError);

    // The server's answer was for the previous session: no retirement, no write-back, and
    // no attempt recorded against an entry that now belongs to nobody in particular.
    const [entry] = await readOutboxBatch(database);
    expect(entry).toBeDefined();
    expect(entry?.attempts).toBe(0);
    const categories = await database.getAllAsync('SELECT id FROM categories WHERE id = ?', [CAT]);
    expect(categories).toHaveLength(1); // the local row, not overwritten by the server's copy
  });

  it('is unaffected when the session did not change', async () => {
    await queueOne();
    const api = createFakeSyncApi();

    const outcome = await drainOutbox({
      database,
      api,
      clock: () => AT,
      guard: captureSession(session),
    });

    expect(outcome.applied).toBe(1);
    expect(await readOutboxBatch(database)).toEqual([]);
  });
});

describe('a pull pass', () => {
  it('does not write a page fetched for the previous session', async () => {
    const api = createFakeSyncApi();
    api.pullHandler = () => {
      switchUser();
      return pullPage({
        changes: [{ entity: 'category', record: serverCategory({ id: CAT, name: 'Theirs' }) }],
        nextCursor: 5,
      });
    };

    await expect(
      pullChanges({ database, api, guard: captureSession(session) }),
    ).rejects.toBeInstanceOf(SessionChangedError);

    expect(await database.getAllAsync('SELECT id FROM categories', [])).toEqual([]);
    expect(await readSyncCursor(database)).toBe(INITIAL_CURSOR);
  });
});

describe('the engine', () => {
  it('abandons a pass that spans a session change without reporting a failure', async () => {
    await queueOne();
    const api = createFakeSyncApi();
    const answer = api.pushHandler;
    api.pushHandler = (body, call) => {
      switchUser();
      return answer(body, call);
    };
    const engine = createSyncEngine({
      database,
      api,
      session,
      reachability: createMemoryReachability(true),
      clock: () => AT,
    });

    const result = await engine.sync('manual');

    expect(result.status).toBe('skipped');
    // No red pill, no error text: nothing failed, the session simply is not the one the
    // pass began in, and the new session's own `sign-in` sync is already due.
    expect(engine.getStatus().lastAttemptFailed).toBe(false);
    expect(engine.getStatus().lastError).toBeNull();
    expect(api.pulls).toEqual([]);
  });
});
