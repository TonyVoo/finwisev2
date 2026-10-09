import type { TokenPair } from '@expense-tracker/shared';
import { createAuthorizedTransport } from '@/api/authorize';
import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';
import { createSessionController } from '@/auth/session';
import { createMemoryTokenStore, sessionFromTokenPair } from '@/auth/tokenStore';
import { createMemoryLocalStore } from '@/db/localStore';

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');
const USER_ID = '0192f5a0-0000-7000-8000-00000000a001';

function tokenPair(suffix: string): TokenPair {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
  };
}

function unauthorizedBody() {
  return { error: { code: 'token_expired', message: 'Access token has expired' } };
}

interface Harness {
  readonly authorized: Transport;
  /** Every request the transport saw, in order. */
  readonly seen: readonly TransportRequest[];
  /** How many times the refresh endpoint was called. */
  readonly refreshCalls: () => number;
  readonly sessionStatus: () => string;
}

interface HarnessOptions {
  /**
   * `attempt` counts calls for this method+path, so a retry can answer differently.
   * May be async, which is what lets a test hold one response open while another
   * request completes.
   */
  readonly respond: (
    request: TransportRequest,
    attempt: number,
  ) => TransportResponse | Promise<TransportResponse>;
  readonly refresh?: (refreshToken: string) => Promise<TokenPair>;
  /** Stored session at startup. `null` means signed out. */
  readonly initial?: TokenPair | null;
}

/**
 * Wires a real session controller to a scripted transport.
 *
 * The interceptor's whole job is coordinating with the session controller, so stubbing
 * the controller out would test an empty shell. The transport is the only fake.
 */
async function harness(options: HarnessOptions): Promise<Harness> {
  const seen: TransportRequest[] = [];
  const attempts = new Map<string, number>();
  let refreshCalls = 0;

  const transport: Transport = async (request) => {
    seen.push(request);
    const key = `${request.method} ${request.path}`;
    const attempt = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, attempt);
    return options.respond(request, attempt);
  };

  const initial = options.initial === undefined ? tokenPair('1') : options.initial;
  const session = createSessionController({
    tokenStore: createMemoryTokenStore(
      initial === null ? null : sessionFromTokenPair(initial, USER_ID, ISSUED_AT),
    ),
    // Nothing here touches local rows; the interceptor only ever rotates tokens.
    localStore: createMemoryLocalStore({ owner: initial === null ? null : USER_ID }),
    refreshTokens: async (refreshToken) => {
      refreshCalls += 1;
      return (options.refresh ?? (async () => tokenPair('2')))(refreshToken);
    },
    clock: () => ISSUED_AT,
  });

  // What the app does at startup: load the stored session before anything requests.
  await session.initialize();

  return {
    authorized: createAuthorizedTransport(transport, session),
    seen,
    refreshCalls: () => refreshCalls,
    sessionStatus: () => session.getSnapshot().status,
  };
}

const GET_ME: TransportRequest = { method: 'get', path: '/v1/me', requiresAuth: true };

describe('createAuthorizedTransport', () => {
  it('attaches the stored access token', async () => {
    const h = await harness({ respond: () => ({ status: 200, body: {}, requestId: null }) });

    await h.authorized(GET_ME);

    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]!.accessToken).toBe('access-1');
  });

  it('passes a non-401 response straight through', async () => {
    const h = await harness({ respond: () => ({ status: 404, body: {}, requestId: null }) });

    expect((await h.authorized(GET_ME)).status).toBe(404);
    expect(h.refreshCalls()).toBe(0);
  });

  it('refreshes on a 401 and retries the request once', async () => {
    const h = await harness({
      respond: (_request, attempt) =>
        attempt === 1
          ? { status: 401, body: unauthorizedBody(), requestId: null }
          : { status: 200, body: { ok: true }, requestId: null },
    });

    const response = await h.authorized(GET_ME);

    expect(response.status).toBe(200);
    expect(h.refreshCalls()).toBe(1);
    expect(h.seen.map((request) => request.accessToken)).toEqual(['access-1', 'access-2']);
  });

  it('does not retry a second time when the retry also 401s', async () => {
    const h = await harness({
      respond: () => ({ status: 401, body: unauthorizedBody(), requestId: null }),
    });

    expect((await h.authorized(GET_ME)).status).toBe(401);
    // One original, one retry. A third would be the start of an infinite loop.
    expect(h.seen).toHaveLength(2);
    expect(h.refreshCalls()).toBe(1);
  });

  it('never refreshes for a route that takes no token', async () => {
    const h = await harness({
      respond: () => ({
        status: 401,
        body: { error: { code: 'invalid_credentials', message: 'nope' } },
        requestId: null,
      }),
    });

    // A failed login is about the password in the body. Refreshing in response to it
    // would rotate a perfectly good refresh token for nothing.
    const response = await h.authorized({
      method: 'post',
      path: '/v1/auth/login',
      requiresAuth: false,
    });

    expect(response.status).toBe(401);
    expect(h.refreshCalls()).toBe(0);
    expect(h.seen[0]!.accessToken).toBeUndefined();
  });

  describe('concurrency', () => {
    /**
     * The failure this prevents: a sync pass fires a pull and a push together, an expired
     * access token 401s both, and each triggers its own refresh. The refresh token is
     * single-use and rotates, so the second rotation arrives with a token the first
     * already revoked - `token_invalid`, and the user is logged out for no reason.
     */
    it('refreshes once for many simultaneous 401s', async () => {
      const paths = ['/v1/me', '/v1/sync', '/v1/categories', '/v1/expenses'];
      const h = await harness({
        respond: (_request, attempt) =>
          attempt === 1
            ? { status: 401, body: unauthorizedBody(), requestId: null }
            : { status: 200, body: {}, requestId: null },
        refresh: async () => {
          // A real refresh is a round trip, so the window for a second one is open.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return tokenPair('2');
        },
      });

      const responses = await Promise.all(
        paths.map((path) => h.authorized({ method: 'get', path, requiresAuth: true })),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      expect(h.refreshCalls()).toBe(1);
      // Every retry used the one new token.
      const retries = h.seen.filter((request) => request.accessToken === 'access-2');
      expect(retries).toHaveLength(4);
    });

    /**
     * The straggler case, which the simultaneous-401 test above does not cover.
     *
     * A request leaves with `access-1` and is slow. While it is on the wire another
     * request 401s and completes a rotation, so the stored token is now `access-2`. Then
     * the straggler's own 401 comes back. It must notice that the token it used is no
     * longer the current one and retry with what is stored, because rotating again would
     * revoke `access-2` out from under everything else using it.
     */
    it('retries with the current token when it 401s after someone else rotated', async () => {
      let deliverStragglerResponse = () => {};
      const stragglerHeld = new Promise<void>((resolve) => {
        deliverStragglerResponse = resolve;
      });

      const h = await harness({
        respond: async (request, attempt) => {
          if (attempt > 1) return { status: 200, body: {}, requestId: null };
          // The straggler's first response is held open: its request is on the wire,
          // carrying `access-1`, while the rotation below happens.
          if (request.path === '/v1/sync') await stragglerHeld;
          return { status: 401, body: unauthorizedBody(), requestId: null };
        },
        refresh: async () => tokenPair('2'),
      });

      const straggler = h.authorized({ method: 'get', path: '/v1/sync', requiresAuth: true });
      // Let it reach the transport, so it has read the token it will be judged against.
      await Promise.resolve();
      expect(h.seen).toHaveLength(1);
      expect(h.seen[0]!.accessToken).toBe('access-1');

      // A second request 401s, refreshes, retries and succeeds. Stored token is now
      // `access-2`.
      await h.authorized({ method: 'get', path: '/v1/me', requiresAuth: true });
      expect(h.refreshCalls()).toBe(1);

      // Only now does the straggler's 401 arrive.
      deliverStragglerResponse();
      const late = await straggler;

      expect(late.status).toBe(200);
      // No second rotation: rotating again would revoke `access-2`, which the request
      // that just succeeded and every later request are relying on.
      expect(h.refreshCalls()).toBe(1);
      expect(h.seen.at(-1)!.accessToken).toBe('access-2');
    });
  });

  describe('when the refresh fails', () => {
    it('ends the session and surfaces the original 401 on token_invalid', async () => {
      const h = await harness({
        respond: () => ({ status: 401, body: unauthorizedBody(), requestId: null }),
        refresh: async () => {
          throw new ApiRequestError({
            status: 401,
            code: 'token_invalid',
            message: 'Refresh token has been rotated',
          });
        },
      });

      const response = await h.authorized(GET_ME);

      expect(response.status).toBe(401);
      // Not retried: there is no token to retry with.
      expect(h.seen).toHaveLength(1);
      expect(h.sessionStatus()).toBe('anonymous');
    });

    // The rule that makes offline-first usable: a refresh that could not reach the
    // server says nothing about whether the session is still valid.
    it('keeps the session and propagates a network failure', async () => {
      const h = await harness({
        respond: () => ({ status: 401, body: unauthorizedBody(), requestId: null }),
        refresh: async () => {
          throw new NetworkUnavailableError(new Error('offline'));
        },
      });

      await expect(h.authorized(GET_ME)).rejects.toThrow(NetworkUnavailableError);
      expect(h.sessionStatus()).toBe('authenticated');
    });

    it('does not retry when there is no session at all', async () => {
      const h = await harness({
        respond: () => ({ status: 401, body: unauthorizedBody(), requestId: null }),
        initial: null,
      });

      expect((await h.authorized(GET_ME)).status).toBe(401);
      expect(h.seen).toHaveLength(1);
      expect(h.refreshCalls()).toBe(0);
    });

    it('does not retry when the refresh returned the same token', async () => {
      const h = await harness({
        respond: () => ({ status: 401, body: unauthorizedBody(), requestId: null }),
        // Pathological, but a retry here would 401 identically and burn a round trip.
        refresh: async () => tokenPair('1'),
      });

      expect((await h.authorized(GET_ME)).status).toBe(401);
      expect(h.seen).toHaveLength(1);
    });
  });
});
