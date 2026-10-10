import type { AuthResponse, TokenPair } from '@expense-tracker/shared';
import { createAuthorizedTransport } from '@/api/authorize';
import type { Transport, TransportRequest } from '@/api/transport';
import { type SessionController, createSessionController } from '@/auth/session';
import { createMemoryTokenStore, sessionFromTokenPair } from '@/auth/tokenStore';
import { createMemoryLocalStore } from '@/db/localStore';

/**
 * What the 401 interceptor does when the *session* changes under an in-flight request.
 *
 * `authorize.test.ts` covers the token changing within one session - a concurrent
 * rotation, a refresh that fails, a retry that 401s again. This file covers the other
 * reason the stored token can differ by the time a request comes back: it now belongs
 * to somebody else.
 *
 * The sequence is a shared device. A request goes out, the network stalls it, the user
 * logs out, a second user logs in, and only then does the first request's 401 arrive.
 * `ensureFreshAccessToken` compares the stale token against the stored one and, finding
 * them different, hands over the stored one - which is the right answer for a rotation
 * and the wrong answer for a new account.
 *
 * Covers `AUTH-22`, `AUTH-23`, `AUTH-24`. See GAP 13.
 */

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');
const USER_A = '0192f5a0-0000-7000-8000-00000000a001';
const USER_B = '0192f5a0-0000-7000-8000-00000000b002';

function tokenPair(suffix: string): TokenPair {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
  };
}

/**
 * Built by spreading the pair, not nesting it, because `AuthResponse` is
 * `{ user, ...TokenPair.shape }`. A nested `tokens` key type-checks through a cast and
 * then stores `accessToken: undefined`, which looks like a passing test.
 */
function authResponse(userId: string, suffix: string): AuthResponse {
  return {
    user: {
      id: userId,
      email: `${suffix}@example.com`,
      currency: 'USD',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    ...tokenPair(suffix),
  };
}

/** User A's outbox batch: the payload that must not reach another account. */
const PUSH_BODY = { items: [{ entity: 'expense', id: 'a-private-expense' }] };

const PUSH: TransportRequest = {
  method: 'post',
  path: '/v1/sync',
  requiresAuth: true,
  body: PUSH_BODY,
};

interface Outcome {
  /** Every request the transport saw, in order. */
  readonly seen: readonly TransportRequest[];
  readonly refreshCalls: number;
  readonly status: number;
}

/**
 * Sends one authorized request as user A and runs `duringFlight` before its 401 lands.
 *
 * The session controller is real - the interceptor's only job is coordinating with it,
 * so stubbing it out would test an empty shell. The transport is the only fake.
 */
async function sendWhile(
  duringFlight: (session: SessionController) => Promise<void>,
): Promise<Outcome> {
  const seen: TransportRequest[] = [];
  let refreshCalls = 0;

  const session = createSessionController({
    tokenStore: createMemoryTokenStore(sessionFromTokenPair(tokenPair('a'), USER_A, ISSUED_AT)),
    localStore: createMemoryLocalStore({ owner: USER_A }),
    refreshTokens: async () => {
      refreshCalls += 1;
      return tokenPair('a-rotated');
    },
    clock: () => ISSUED_AT,
  });
  await session.initialize();

  let attempt = 0;
  const transport: Transport = async (request) => {
    seen.push(request);
    attempt += 1;
    if (attempt === 1) {
      await duringFlight(session);
      return {
        status: 401,
        body: { error: { code: 'token_expired', message: 'Access token has expired' } },
        requestId: null,
      };
    }
    return { status: 200, body: { results: [] }, requestId: null };
  };

  const response = await createAuthorizedTransport(transport, session)(PUSH);
  return { seen, refreshCalls, status: response.status };
}

describe('the 401 interceptor when the session changes mid-request', () => {
  // AUTH-22. Passes today. Kept because it is the branch most easily broken by a fix to
  // AUTH-23: a guard that refuses to retry after *any* session change must still leave
  // this one surfacing the original 401 rather than inventing a success.
  it('surfaces the original 401 when the user signed out while the request was away', async () => {
    const { seen, refreshCalls, status } = await sendWhile(async (session) => {
      await session.signOut();
    });

    expect(seen).toHaveLength(1);
    expect(status).toBe(401);
    // There is no refresh token left to rotate, so attempting one would be a wasted
    // round trip against a session that is deliberately gone.
    expect(refreshCalls).toBe(0);
  });

  // AUTH-23. The defect. Expected-fail until GAP 13 is fixed.
  //
  // Asserted as "no request after the first carries user B's token" rather than as one
  // preferred outcome, because two different fixes are both correct here: refusing to
  // retry at all, and retrying fail-closed without a token. Pinning either one
  // specifically would turn this red against a correct fix.
  it.failing(
    'does not retry user A’s request under user B’s token when B signs in mid-flight',
    async () => {
      const { seen } = await sendWhile(async (session) => {
        await session.signOut();
        await session.signIn(authResponse(USER_B, 'b'));
      });

      const underUserB = seen.slice(1).filter((request) => request.accessToken === 'access-b');
      expect(underUserB).toEqual([]);
    },
  );

  // AUTH-24. The same defect seen from the payload side, which is what makes it a leak
  // rather than a nuisance: the retry replays the body built from user A's rows, so the
  // server files one account's spending into another's. Expected-fail until GAP 13.
  //
  // Separate from AUTH-23 because it fails for a reason a reader needs stated on its
  // own. The local wipe that `signOut` performs cannot defend this: the batch was
  // serialised into the request before the wipe ran and is held in memory, not in SQLite.
  it.failing('does not replay user A’s push body into user B’s account', async () => {
    const { seen } = await sendWhile(async (session) => {
      await session.signOut();
      await session.signIn(authResponse(USER_B, 'b'));
    });

    const leaked = seen
      .slice(1)
      .filter((request) => request.accessToken === 'access-b' && request.body === PUSH_BODY);
    expect(leaked).toEqual([]);
  });

  // AUTH-25. The boundary of whatever fixes GAP 13, and deliberately permissive.
  //
  // Re-login as the *same* user leaves the account unchanged, so retrying under the new
  // token is defensible and so is failing closed. Only the unsafe outcome is asserted,
  // so a generation-counter fix that refuses every post-change retry stays green here.
  it('never retries under a token belonging to a different account after a re-login', async () => {
    const { seen } = await sendWhile(async (session) => {
      await session.signIn(authResponse(USER_A, 'a-relogin'));
    });

    const foreign = seen.filter(
      (request) =>
        request.accessToken !== undefined &&
        request.accessToken !== null &&
        !['access-a', 'access-a-rotated', 'access-a-relogin'].includes(request.accessToken),
    );
    expect(foreign).toEqual([]);
  });
});
