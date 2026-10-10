import type { AuthResponse } from '@expense-tracker/shared';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';
import { type StoredSession, createMemoryTokenStore } from '@/auth/tokenStore';
import { createAppContainer } from '@/bootstrap/container';
import { OWNER_KEY } from '@/db/localStore';
import { migrate } from '@/db/migrations';
import { applyLocalMutation } from '@/db/write';
import { type TestDatabase, createTestDatabase } from '../support/sqlite';

/**
 * The composition root, driven as a whole.
 *
 * Every part it wires is unit-tested on its own, and none of those tests can see the knot
 * this module exists to tie. Its own doc comment states two ordering guarantees that
 * nothing enforced before this file: the refresh call must not go through the 401
 * interceptor it serves, and the database must be open and adopted before a session is
 * published. Both are satisfiable by code that compiles and fails only on a device - the
 * second is `TVO-16`, and the composition root is the one place its fix can be undone
 * without a single unit test going red.
 *
 * `AppContainerOptions` exists so this can be built without native modules. Nothing used
 * it until now.
 */

const USER_A = '0192f5a0-0000-7000-8000-00000000a001';
const USER_B = '0192f5a0-0000-7000-8000-00000000b001';

const STORED_A: StoredSession = {
  userId: USER_A,
  accessToken: 'access-a',
  accessTokenExpiresAt: Date.parse('2026-10-09T11:00:00.000Z'),
  refreshToken: 'refresh-a',
  refreshTokenExpiresAt: Date.parse('2026-12-08T10:00:00.000Z'),
};

const ROTATED = {
  accessToken: 'access-a2',
  refreshToken: 'refresh-a2',
  accessTokenExpiresIn: 3600,
  refreshTokenExpiresAt: '2026-12-08T11:00:00.000Z',
};

const AUTH_B: AuthResponse = {
  user: {
    id: USER_B,
    email: 'b@example.com',
    currency: 'USD',
    createdAt: '2026-10-09T10:00:00.000Z',
  },
  accessToken: 'access-b',
  refreshToken: 'refresh-b',
  accessTokenExpiresIn: 3600,
  refreshTokenExpiresAt: '2026-12-08T10:00:00.000Z',
};

const ME_BODY = { user: AUTH_B.user };

const EXPIRED_401 = {
  status: 401,
  body: { error: { code: 'token_expired', message: 'Access token has expired' } },
  requestId: null,
} as const satisfies TransportResponse;

/** A transport that answers from a script and records every request it was handed. */
function scriptedTransport(script: (request: TransportRequest) => TransportResponse) {
  const seen: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    seen.push(request);
    return script(request);
  };
  return { transport, seen };
}

/** 401s `access-a`, rotates on the refresh route, answers anything else. */
function expiringTransport() {
  return scriptedTransport((request) => {
    if (request.path === '/v1/auth/refresh') {
      return { status: 200, body: ROTATED, requestId: null };
    }
    return request.accessToken === 'access-a'
      ? EXPIRED_401
      : { status: 200, body: ME_BODY, requestId: null };
  });
}

const WRITTEN_AT = new Date('2026-10-09T09:00:00.000Z');

describe('createAppContainer', () => {
  let database: TestDatabase;
  let mutations = 0;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    mutations = 0;
  });

  afterEach(() => {
    database.close();
  });

  async function owner(): Promise<string | null> {
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM meta WHERE key = ?',
      [OWNER_KEY],
    );
    return row?.value ?? null;
  }

  async function seedCategory(): Promise<void> {
    mutations += 1;
    await applyLocalMutation(
      database,
      {
        entity: 'category',
        id: `0192f5a0-0000-7000-8000-0000000000c${mutations}`,
        fields: { name: 'Rent', color: '#2F8044' },
      },
      {
        clock: () => WRITTEN_AT,
        newMutationId: () => `0192f5a0-0000-7000-8000-30000000000${mutations}`,
      },
    );
  }

  it('publishes the stored session, over the database it was handed', async () => {
    const { transport } = scriptedTransport(() => ({ status: 200, body: {}, requestId: null }));

    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(STORED_A),
      transport,
    });

    expect(container.session.getSnapshot()).toEqual({ status: 'authenticated', expired: false });
    expect(container.database).toBe(database);
  });

  // The belt-and-braces half of TVO-16: a database restored from a backup beside somebody
  // else's tokens. It is only reachable if the session was wired to the *sqlite* store
  // over the opened database. A `createMemoryLocalStore()` here would leave these rows in
  // place and `meta` empty, and every other test in the suite would still pass.
  it('adopts the opened database at startup, before any screen can read it', async () => {
    await seedCategory();
    expect(await owner()).toBeNull();

    const { transport } = scriptedTransport(() => ({ status: 200, body: {}, requestId: null }));
    await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(STORED_A),
      transport,
    });

    expect(await owner()).toBe(USER_A);
    // Unowned but populated is somebody else's, so the rows are gone.
    await expect(database.getAllAsync('SELECT id FROM categories', [])).resolves.toEqual([]);
  });

  it('attaches the stored access token to an authenticated call', async () => {
    const { transport, seen } = scriptedTransport(() => ({
      status: 200,
      body: ME_BODY,
      requestId: null,
    }));

    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(STORED_A),
      transport,
    });
    await container.api.getMe();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ path: '/v1/me', requiresAuth: true, accessToken: 'access-a' });
  });

  /**
   * The 401 round trip through the real wiring: the stored refresh token is the one sent,
   * the retry carries the rotated access token, and the whole thing is three requests.
   *
   * What this case does **not** prove is the claim the module's own doc comment makes for
   * its ordering - that building `publicApi` on the raw transport is what keeps a refresh
   * out of the interceptor that triggered it. Wiring `refreshTokens` to the *authorized*
   * client instead was tried here and changed nothing observable, because `authorize.ts`
   * returns early for a route with `auth: false` and the refresh route is one. The single
   * live defence is that short-circuit, pinned by `authorize.test.ts`; the ordering here
   * is a second, currently inert layer. Worth knowing before anyone leans on the wrong one.
   */
  it('refreshes through the unauthenticated transport, and retries once', async () => {
    const { transport, seen } = expiringTransport();

    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(STORED_A),
      transport,
    });
    await expect(container.api.getMe()).resolves.toEqual(ME_BODY);

    expect(seen.map((request) => `${request.method} ${request.path}`)).toEqual([
      'get /v1/me',
      'post /v1/auth/refresh',
      'get /v1/me',
    ]);
    const refresh = seen[1]!;
    expect(refresh.requiresAuth).toBe(false);
    expect(refresh.accessToken).toBeUndefined();
    expect(refresh.body).toEqual({ refreshToken: 'refresh-a' });
    expect(seen[2]!.accessToken).toBe('access-a2');
  });

  // One refresh for many concurrent 401s, through the real wiring rather than the
  // controller alone: the refresh token is single-use, so a second rotation would arrive
  // already revoked and log the user out for no reason.
  it('rotates once for two calls that 401 together', async () => {
    const { transport, seen } = expiringTransport();

    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(STORED_A),
      transport,
    });
    await Promise.all([container.api.getMe(), container.api.getMe()]);

    expect(seen.filter((request) => request.path === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('starts anonymous, and leaves the store unclaimed, with no stored session', async () => {
    const { transport, seen } = scriptedTransport(() => ({
      status: 200,
      body: {},
      requestId: null,
    }));

    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(null),
      transport,
    });

    expect(container.session.getSnapshot().status).toBe('anonymous');
    expect(await owner()).toBeNull();
    // A cold start of an offline-first app talks to nobody.
    expect(seen).toEqual([]);
  });

  // The live half of TVO-16, through the real wiring: a second account on the same device.
  it('wipes the previous user out of the opened database when another signs in', async () => {
    const { transport } = scriptedTransport(() => ({ status: 200, body: {}, requestId: null }));
    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(STORED_A),
      transport,
    });
    await seedCategory();

    await container.session.signIn(AUTH_B);

    expect(await owner()).toBe(USER_B);
    await expect(database.getAllAsync('SELECT id FROM categories', [])).resolves.toEqual([]);
  });

  it('builds a query client configured for a local cache', async () => {
    const { transport } = scriptedTransport(() => ({ status: 200, body: {}, requestId: null }));
    const container = await createAppContainer({
      database,
      tokenStore: createMemoryTokenStore(null),
      transport,
    });

    expect(container.queryClient.getDefaultOptions().queries).toMatchObject({
      retry: false,
      staleTime: Infinity,
    });
  });
});
