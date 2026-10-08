import type { ErrorCode, TokenPair } from '@expense-tracker/shared';
import { ApiRequestError } from '../api/errors';
import { type Clock, systemClock } from '../lib/clock';
import { type StoredSession, type TokenStore, sessionFromTokenPair } from './tokenStore';

/**
 * Owns the session: what is stored, when it is refreshed, and when it is gone.
 *
 * Framework-free on purpose - it is a plain store with `subscribe`/`getSnapshot`, which
 * React consumes through `useSyncExternalStore` in `SessionProvider.tsx`. That keeps
 * every rule below testable without rendering anything, and lets a background sync task
 * use the same controller outside the React tree.
 */

export type SessionStatus =
  /** Secure store has not been read yet. The splash screen is still up. */
  'loading' | 'anonymous' | 'authenticated';

export interface SessionSnapshot {
  readonly status: SessionStatus;
  /**
   * True when the session ended because the server rejected the refresh token, rather
   * than because the user logged out. Drives the "Your session expired. Please log in
   * again." banner on Welcome (`docs/design/03-auth.md` §1). Cleared on the next sign-in.
   */
  readonly expired: boolean;
}

export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Read the stored session once, at startup. Resolves to the resulting snapshot. */
  initialize(): Promise<SessionSnapshot>;
  /** The current access token, or null when there is no session. */
  getAccessToken(): Promise<string | null>;
  /**
   * Obtain an access token newer than `staleAccessToken`, refreshing at most once across
   * all concurrent callers. Returns null when the session is gone.
   */
  ensureFreshAccessToken(staleAccessToken: string | null): Promise<string | null>;
  /** Adopt a pair from signup or login. */
  signIn(pair: TokenPair): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * Refresh failures that mean the session is unrecoverable and the user has to log in.
 *
 * Everything *not* in this set - above all a {@link NetworkUnavailableError} - leaves the
 * session untouched. That is the load-bearing rule of an offline-first app: being
 * offline for a week must not log anyone out, so a refresh that cannot reach the server
 * is a retry, never a logout.
 */
const UNRECOVERABLE_CODES: readonly ErrorCode[] = [
  'token_invalid',
  'token_expired',
  'unauthorized',
  'invalid_credentials',
];

export interface SessionControllerOptions {
  readonly tokenStore: TokenStore;
  /**
   * Exchanges a refresh token for a rotated pair. Injected rather than imported so this
   * module does not depend on the API client that depends on it - and so it is wired to
   * the *unauthenticated* transport, which is what keeps a refresh from recursing into
   * the 401 interceptor that triggered it.
   */
  readonly refreshTokens: (refreshToken: string) => Promise<TokenPair>;
  readonly clock?: Clock;
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  const { tokenStore, refreshTokens, clock = systemClock } = options;

  let session: StoredSession | null = null;
  let snapshot: SessionSnapshot = { status: 'loading', expired: false };
  const listeners = new Set<() => void>();

  /**
   * The in-flight refresh, shared by every caller.
   *
   * This is the whole point of routing refreshes through here. A sync pass fires a pull
   * and a push at once; an expired access token 401s both. One refresh per 401 would
   * send two rotations of a single-use refresh token, and the second would arrive with
   * a token the first had already revoked - `token_invalid`, session dropped, user
   * logged out for no reason. One refresh, both requests retried with its result.
   */
  let inFlightRefresh: Promise<string | null> | null = null;

  function publish(next: SessionSnapshot): void {
    if (next.status === snapshot.status && next.expired === snapshot.expired) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function persist(next: StoredSession): Promise<void> {
    await tokenStore.write(next);
    session = next;
    publish({ status: 'authenticated', expired: false });
  }

  async function discard(expired: boolean): Promise<void> {
    await tokenStore.clear();
    session = null;
    publish({ status: 'anonymous', expired });
  }

  async function performRefresh(): Promise<string | null> {
    const current = session;
    if (current === null) return null;

    try {
      const pair = await refreshTokens(current.refreshToken);
      await persist(sessionFromTokenPair(pair, clock()));
      return pair.accessToken;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        UNRECOVERABLE_CODES.includes(error.code as ErrorCode)
      ) {
        await discard(true);
        return null;
      }
      // Network failure, 5xx, rate limit: the session is probably still valid. Keep it
      // and let the caller surface the failure; the next attempt may well succeed.
      throw error;
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async initialize() {
      session = await tokenStore.read();
      publish({
        status: session === null ? 'anonymous' : 'authenticated',
        expired: false,
      });
      return snapshot;
    },

    async getAccessToken() {
      return session?.accessToken ?? null;
    },

    async ensureFreshAccessToken(staleAccessToken) {
      if (session === null) return null;

      // Another request already refreshed while this one was in flight: the stored token
      // is no longer the one it used. Hand that over instead of rotating again - a
      // second rotation here would revoke the token the first request is about to use.
      if (staleAccessToken !== null && session.accessToken !== staleAccessToken) {
        return session.accessToken;
      }

      // No `await` between the check and the assignment, so concurrent callers can only
      // observe this as already set.
      if (inFlightRefresh === null) {
        inFlightRefresh = (async () => {
          try {
            return await performRefresh();
          } finally {
            inFlightRefresh = null;
          }
        })();
      }
      return inFlightRefresh;
    },

    async signIn(pair) {
      await persist(sessionFromTokenPair(pair, clock()));
    },

    async signOut() {
      await discard(false);
    },
  };
}
