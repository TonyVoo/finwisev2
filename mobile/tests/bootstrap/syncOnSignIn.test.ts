import type { AuthResponse } from '@expense-tracker/shared';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';
import { createMemoryTokenStore } from '@/auth/sessionRecord';
import { createAppContainer } from '@/bootstrap/container';
import { migrate } from '@/db/migrations';
import { createMemoryReachability } from '@/sync/reachability';
import { type TestDatabase, createTestDatabase } from '../support/sqlite';

/**
 * `SYNC-59` / `SYNC-60`. Signing in is not one of the engine's six triggers, and the one
 * sync that did run happened before there was a session to run it under.
 *
 * Found on a device (21 Oct, Pixel 9 / API 36 / Expo Go, live API + Postgres), not here:
 * the app was relaunched logged out, logged in against a healthy server, and Home came up
 * reading `$0.00` / `No expenses yet` under a red `Sync failed` pill while the server held
 * the account's expense. Eight minutes and zero `/v1/sync` requests later it still did.
 * Backgrounding and foregrounding the app - the `app-open` trigger - fetched it at once.
 *
 * The cause is in `bootstrap/AppProviders.tsx`: `SyncProvider` is mounted **above** the
 * auth gate, so `engine.start()` runs on launch, pulls with no bearer token, takes a
 * `401 unauthorized`, and sets `lastAttemptFailed`. Nothing in `engine.ts` or
 * `SyncProvider.tsx` listens to `SessionController`, so the session that arrives a moment
 * later neither clears that flag nor starts the sync it should have been waiting for.
 *
 * Both cases are written against the **container**, not against either half, because this
 * is a wiring defect of exactly the shape `container.test.ts` was added for: `engine.ts`
 * and `session.ts` are each correct alone, and no unit case on either can see that nothing
 * joins them. It is also why these assert on an outcome - a pull happened, the row landed,
 * the pill is not in its error state - rather than on a named listener. Either fix is fine
 * (mount the provider under the gate, or subscribe the engine to the session); a test that
 * pinned one would reject the other.
 *
 * Both were `it.failing` until `TVO-34` landed (the container now syncs on the transition
 * to `authenticated`) and are ordinary cases now.
 */

const USER = '0192f5a0-0000-7000-8000-00000000a001';
const CATEGORY = '0192f5a0-0000-7000-8000-0000000c0001';
const EXPENSE = '0192f5a0-0000-7000-8000-0000000e0001';

const AUTH: AuthResponse = {
  user: {
    id: USER,
    email: 'a@example.com',
    currency: 'USD',
    createdAt: '2026-10-21T06:00:00.000Z',
  },
  accessToken: 'access-a',
  refreshToken: 'refresh-a',
  accessTokenExpiresIn: 3600,
  refreshTokenExpiresAt: '2026-12-20T06:00:00.000Z',
};

const UNAUTHORIZED: TransportResponse = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Authentication required' } },
  requestId: null,
};

/** One expense waiting on the server, the way a returning user's history would be. */
const PAGE = {
  changes: [
    {
      entity: 'category',
      record: {
        id: CATEGORY,
        name: 'Groceries',
        color: '#2F8044',
        isDefault: false,
        monthlyBudgetMinor: null,
        createdAt: '2026-10-21T06:00:00.000Z',
        updatedAt: '2026-10-21T06:00:00.000Z',
        deletedAt: null,
        revision: 1,
      },
    },
    {
      entity: 'expense',
      record: {
        id: EXPENSE,
        categoryId: CATEGORY,
        kind: 'expense',
        amountMinor: 4242,
        currency: 'USD',
        originalAmountMinor: null,
        originalCurrency: null,
        date: '2026-10-21',
        note: 'seeded by another device',
        createdAt: '2026-10-21T06:00:00.000Z',
        updatedAt: '2026-10-21T06:00:00.000Z',
        deletedAt: null,
        revision: 2,
      },
    },
  ],
  nextCursor: 2,
  hasMore: false,
  resyncRequired: false,
  serverTime: '2026-10-21T06:30:00.000Z',
};

/**
 * The server the device met: a pull with no bearer token is `401 unauthorized`, and the
 * same pull with one returns the account's rows.
 *
 * The 401 is what makes this a regression test rather than a feature test. A stand-in that
 * answered the anonymous pull happily would leave the engine in its idle state, and the
 * second case would then pass against the unfixed code for the wrong reason.
 */
function serverRequiringAuth() {
  const seen: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    seen.push(request);
    if (request.accessToken === null || request.accessToken === undefined) {
      return UNAUTHORIZED;
    }
    if (request.path.startsWith('/v1/sync') && request.method === 'get') {
      return { status: 200, body: PAGE, requestId: null };
    }
    return { status: 200, body: { user: AUTH.user }, requestId: null };
  };
  return { transport, seen };
}

const pullsIn = (seen: readonly TransportRequest[]) =>
  seen.filter((r) => r.method === 'get' && r.path.startsWith('/v1/sync'));

describe('a session arriving after the engine has started', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  async function launchedAnonymous() {
    const { transport, seen } = serverRequiringAuth();
    const container = await createAppContainer({
      database,
      transport,
      tokenStore: createMemoryTokenStore(null),
      reachability: createMemoryReachability(true),
    });
    // What `SyncProvider`'s mount effect does, and the whole of the bug's setup: the
    // engine starts while the user is still on Welcome.
    await container.sync.start();
    return { container, seen };
  }

  /**
   * `SYNC-59`. The precondition, asserted so the two cases below cannot pass vacuously:
   * the launch really does put the engine in its failed state, against a server that
   * really did answer.
   */
  it('fails its first sync when it starts before there is a session', async () => {
    const { container, seen } = await launchedAnonymous();

    expect(container.session.getSnapshot().status).toBe('anonymous');
    expect(pullsIn(seen)).toHaveLength(1);
    expect(container.sync.getStatus().lastAttemptFailed).toBe(true);
  });

  /**
   * `SYNC-59`. The user's own data is the thing at stake: after signing in, Home reads
   * from SQLite and nothing has put the server's rows there.
   */
  it('pulls the account rows once the user signs in', async () => {
    const { container, seen } = await launchedAnonymous();
    const before = pullsIn(seen).length;

    await container.session.signIn(AUTH);
    // Any fix is asynchronous; give it the microtask turns a sync needs to finish.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pullsIn(seen).length).toBeGreaterThan(before);
    const row = await database.getFirstAsync<{ id: string; amountMinor: number }>(
      'SELECT id, amountMinor FROM expenses WHERE id = ?',
      [EXPENSE],
    );
    expect(row).toEqual({ id: EXPENSE, amountMinor: 4242 });
  });

  /**
   * `SYNC-60`. The pill, separately from the data. `02-offline-and-sync.md` §3 state 6 is
   * "last sync attempt failed **while online**", and after a successful sign-in the last
   * attempt that means anything is the one the sign-in should have caused. Leaving the
   * anonymous 401 showing tells a user whose app is working perfectly that it is broken,
   * and `Try again` is the only control that clears it.
   */
  it('does not leave the pill reporting the anonymous failure', async () => {
    const { container } = await launchedAnonymous();

    await container.session.signIn(AUTH);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.sync.getStatus().lastAttemptFailed).toBe(false);
    expect(container.sync.getStatus().lastError).toBeNull();
  });
});
