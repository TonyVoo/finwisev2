import type { AuthResponse, TokenPair } from '@expense-tracker/shared';
import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
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

/** What signup and login return: a pair plus the user it belongs to. */
function authResponse(suffix: string, userId: string = USER_ID): AuthResponse {
  return {
    user: {
      id: userId,
      email: `${suffix}@example.com`,
      currency: 'USD',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    ...tokenPair(suffix),
  };
}

/**
 * The local store is the in-memory fake here. What the session does to the *rows* is
 * `sessionTeardown.test.ts`, over a real SQLite database; this file is about the tokens
 * and the published snapshot, and a database would only slow it down.
 */
function controllerWith(
  stored: TokenPair | null,
  refreshTokens: (refreshToken: string) => Promise<TokenPair> = async () => tokenPair('2'),
) {
  const tokenStore = createMemoryTokenStore(
    stored === null ? null : sessionFromTokenPair(stored, USER_ID, ISSUED_AT),
  );
  const controller = createSessionController({
    tokenStore,
    localStore: createMemoryLocalStore({ owner: stored === null ? null : USER_ID }),
    refreshTokens,
    clock: () => ISSUED_AT,
  });
  return { controller, tokenStore };
}

describe('createSessionController', () => {
  it('starts in loading, before secure store has been read', () => {
    const { controller } = controllerWith(null);
    // The root layout holds the splash screen on this state, which is why no route
    // guard below it has to handle "we do not know yet".
    expect(controller.getSnapshot()).toEqual({ status: 'loading', expired: false });
  });

  it('becomes authenticated when a session is stored', async () => {
    const { controller } = controllerWith(tokenPair('1'));
    await controller.initialize();

    expect(controller.getSnapshot()).toEqual({ status: 'authenticated', expired: false });
    await expect(controller.getAccessToken()).resolves.toBe('access-1');
  });

  it('becomes anonymous when nothing is stored', async () => {
    const { controller } = controllerWith(null);
    await controller.initialize();

    expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: false });
    await expect(controller.getAccessToken()).resolves.toBeNull();
  });

  it('notifies subscribers on a change and not otherwise', async () => {
    const { controller } = controllerWith(tokenPair('1'));
    const listener = jest.fn();
    controller.subscribe(listener);

    await controller.initialize();
    expect(listener).toHaveBeenCalledTimes(1);

    // Already authenticated; re-publishing the same snapshot would re-render the whole
    // tree for nothing.
    await controller.signIn(authResponse('1'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', async () => {
    const { controller } = controllerWith(null);
    const listener = jest.fn();
    controller.subscribe(listener)();

    await controller.initialize();
    expect(listener).not.toHaveBeenCalled();
  });

  describe('signIn and signOut', () => {
    it('persists a pair so the session survives a restart', async () => {
      const { controller, tokenStore } = controllerWith(null);
      await controller.initialize();

      await controller.signIn(authResponse('1'));

      expect(controller.getSnapshot().status).toBe('authenticated');
      await expect(tokenStore.read()).resolves.toMatchObject({
        // Persisted beside the tokens, because it is what tells a cold start whether the
        // local database belongs to this session (`src/db/localStore.ts`).
        userId: USER_ID,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        // Derived once from the relative `accessTokenExpiresIn`, so a cold start can
        // reason about it without knowing when the app last ran.
        accessTokenExpiresAt: ISSUED_AT.getTime() + 3600 * 1000,
      });
    });

    it('clears the store on sign out and does not call it expiry', async () => {
      const { controller, tokenStore } = controllerWith(tokenPair('1'));
      await controller.initialize();

      await controller.signOut();

      // `expired: false` - the user chose this, so Welcome must not accuse the session
      // of having expired (docs/design/03-auth.md §1).
      expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: false });
      await expect(tokenStore.read()).resolves.toBeNull();
    });
  });

  describe('ensureFreshAccessToken', () => {
    it('rotates and persists the new pair', async () => {
      const { controller, tokenStore } = controllerWith(tokenPair('1'));
      await controller.initialize();

      await expect(controller.ensureFreshAccessToken('access-1')).resolves.toBe('access-2');
      // The rotated pair carries no user, so the owner has to survive the rotation - a
      // refresh that dropped it would read as a session with no owner on the next launch,
      // which the token store treats as no session at all.
      await expect(tokenStore.read()).resolves.toMatchObject({
        refreshToken: 'refresh-2',
        userId: USER_ID,
      });
    });

    it('sends the stored refresh token, not the access token', async () => {
      const seen: string[] = [];
      const { controller } = controllerWith(tokenPair('1'), async (refreshToken) => {
        seen.push(refreshToken);
        return tokenPair('2');
      });
      await controller.initialize();

      await controller.ensureFreshAccessToken('access-1');
      expect(seen).toEqual(['refresh-1']);
    });

    it('refreshes once for concurrent callers', async () => {
      let calls = 0;
      const { controller } = controllerWith(tokenPair('1'), async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return tokenPair('2');
      });
      await controller.initialize();

      const results = await Promise.all([
        controller.ensureFreshAccessToken('access-1'),
        controller.ensureFreshAccessToken('access-1'),
        controller.ensureFreshAccessToken('access-1'),
      ]);

      // The refresh token is single-use and rotates. Three rotations would have the
      // second arrive already revoked.
      expect(calls).toBe(1);
      expect(results).toEqual(['access-2', 'access-2', 'access-2']);
    });

    it('allows a later refresh after the first has settled', async () => {
      let calls = 0;
      const { controller } = controllerWith(tokenPair('1'), async () => {
        calls += 1;
        return tokenPair(String(calls + 1));
      });
      await controller.initialize();

      await controller.ensureFreshAccessToken('access-1');
      // The in-flight slot has to be released, or the session can never refresh again
      // for the rest of the process.
      await controller.ensureFreshAccessToken('access-2');
      expect(calls).toBe(2);
    });

    it('returns null without calling the server when there is no session', async () => {
      let calls = 0;
      const { controller } = controllerWith(null, async () => {
        calls += 1;
        return tokenPair('2');
      });
      await controller.initialize();

      await expect(controller.ensureFreshAccessToken(null)).resolves.toBeNull();
      expect(calls).toBe(0);
    });

    describe('when the server rejects the refresh token', () => {
      it.each(['token_invalid', 'token_expired', 'unauthorized'] as const)(
        'ends the session and marks it expired on %s',
        async (code) => {
          const { controller, tokenStore } = controllerWith(tokenPair('1'), async () => {
            throw new ApiRequestError({ status: 401, code, message: 'nope' });
          });
          await controller.initialize();

          await expect(controller.ensureFreshAccessToken('access-1')).resolves.toBeNull();
          expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: true });
          // Keeping a revoked token would mean every later request 401s and refreshes
          // against a token the server has already thrown away.
          await expect(tokenStore.read()).resolves.toBeNull();
        },
      );

      it('clears the expired flag on the next sign in', async () => {
        const { controller } = controllerWith(tokenPair('1'), async () => {
          throw new ApiRequestError({ status: 401, code: 'token_invalid', message: 'nope' });
        });
        await controller.initialize();
        await controller.ensureFreshAccessToken('access-1');
        expect(controller.getSnapshot().expired).toBe(true);

        await controller.signIn(authResponse('3'));
        expect(controller.getSnapshot()).toEqual({ status: 'authenticated', expired: false });
      });
    });

    /**
     * The rule the whole offline-first story rests on. `docs/PLAN.md` §Backend: "the app
     * must not log the user out because they were offline for a week." A refresh that
     * never reached a server is evidence about the network, not about the session.
     */
    describe('when the refresh cannot reach the server', () => {
      it('keeps the session on a network failure', async () => {
        const { controller, tokenStore } = controllerWith(tokenPair('1'), async () => {
          throw new NetworkUnavailableError(new Error('offline'));
        });
        await controller.initialize();

        await expect(controller.ensureFreshAccessToken('access-1')).rejects.toThrow(
          NetworkUnavailableError,
        );
        expect(controller.getSnapshot()).toEqual({ status: 'authenticated', expired: false });
        await expect(tokenStore.read()).resolves.not.toBeNull();
      });

      it.each([500, 429] as const)('keeps the session on a %s', async (status) => {
        const { controller } = controllerWith(tokenPair('1'), async () => {
          throw new ApiRequestError({ status, code: 'internal_error', message: 'boom' });
        });
        await controller.initialize();

        await expect(controller.ensureFreshAccessToken('access-1')).rejects.toThrow(
          ApiRequestError,
        );
        // A server fault says nothing about whether the refresh token is valid.
        expect(controller.getSnapshot().status).toBe('authenticated');
      });

      it('can retry after a failure', async () => {
        let attempt = 0;
        const { controller } = controllerWith(tokenPair('1'), async () => {
          attempt += 1;
          if (attempt === 1) throw new NetworkUnavailableError(new Error('offline'));
          return tokenPair('2');
        });
        await controller.initialize();

        await expect(controller.ensureFreshAccessToken('access-1')).rejects.toThrow();
        await expect(controller.ensureFreshAccessToken('access-1')).resolves.toBe('access-2');
      });
    });
  });
});
