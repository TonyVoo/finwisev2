import type { AuthResponse, ErrorCode, TokenPair } from '@expense-tracker/shared';
import { ApiRequestError } from '../api/errors';
import type { LocalStore } from '../db/localStore';
import { type Clock, systemClock } from '../lib/clock';
import { type StoredSession, type TokenStore, sessionFromTokenPair } from './sessionRecord';

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
   * Which session this is: a counter that moves whenever the session's *identity* does -
   * every sign-in, every sign-out, every forced clear - and never on a token rotation.
   *
   * It exists so a request that outlives a session change can tell. Comparing tokens
   * cannot: a rotation and an account switch both leave the stored token different from
   * the one a request went out with, and only one of them is safe to retry under
   * (`TVO-20`, `AUTH-23`/`AUTH-24`).
   */
  getEpoch(): number;
  /**
   * Obtain an access token newer than `staleAccessToken`, refreshing at most once across
   * all concurrent callers. Returns null when the session is gone.
   */
  ensureFreshAccessToken(staleAccessToken: string | null): Promise<string | null>;
  /**
   * Adopt the session signup or login returned.
   *
   * Takes the whole {@link AuthResponse} rather than its token pair because the user it
   * names is half the session: it is what the local store is stamped with, and dropping
   * it here is what let one account read another's data (`TVO-16`).
   */
  signIn(auth: AuthResponse): Promise<void>;
  /**
   * Install a replacement token pair for the *same* signed-in user, as the server issues
   * after a password change (every other session is revoked, this device gets a new one).
   *
   * Not a sign-in: the epoch does not move and the local database is untouched, because
   * nothing about whose data this is has changed - the same reason a refresh rotation does
   * not bump it. A no-op when the session is already gone, so a pair that arrives after a
   * logout cannot resurrect the session it belonged to.
   */
  adoptTokenPair(pair: TokenPair): Promise<void>;
  /**
   * End the session the user asked to end: tokens revoked locally **and the local
   * database wiped**, per `docs/design/04-expense-list.md` §Behaviour rule 14.
   *
   * This is deliberately not the same as the forced clear on an unrecoverable refresh -
   * see {@link UNRECOVERABLE_CODES} and the note on `discard`.
   */
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
   * The local database, as far as session changes are concerned.
   *
   * Required, not optional. An optional guard against a cross-account data leak is one
   * forgotten argument away from no guard at all, and the failure is silent: the app
   * works perfectly until the second account logs in. Tests and the web preview target
   * pass `createMemoryLocalStore()`.
   */
  readonly localStore: LocalStore;
  /**
   * Exchanges a refresh token for a rotated pair. Injected rather than imported so this
   * module does not depend on the API client that depends on it - and so it is wired to
   * the *unauthenticated* transport, which is what keeps a refresh from recursing into
   * the 401 interceptor that triggered it.
   */
  readonly refreshTokens: (refreshToken: string) => Promise<TokenPair>;
  /**
   * Tells the server to revoke a refresh token (`POST /v1/auth/logout`), called on an
   * explicit logout only. Best-effort by rule 14 of `04-expense-list.md`: it is never
   * awaited and its failure is swallowed, because a logout that waited on the network
   * - or failed when offline - would be a logout that does not work on a plane. The
   * cost of a missed revoke is a refresh token that lives out its 60 days on a device
   * that has already forgotten it.
   *
   * Optional only so the many controllers built in tests need not supply one; the
   * container always does (`bootstrap/container.ts`, pinned end to end by `tests/screens/settings.test.tsx`).
   */
  readonly revokeRefreshToken?: (refreshToken: string) => Promise<void>;
  readonly clock?: Clock;
}

export function createSessionController(options: SessionControllerOptions): SessionController {
  const {
    tokenStore,
    localStore,
    refreshTokens,
    revokeRefreshToken,
    clock = systemClock,
  } = options;

  let session: StoredSession | null = null;
  /** See {@link SessionController.getEpoch}. Bumped before anything is published. */
  let epoch = 0;
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

  /**
   * Drop the session, leaving the local database alone.
   *
   * The second half is the point and is not an oversight. This runs on the forced clear
   * after an unrecoverable refresh, and the user it runs for - offline past the 60-day
   * refresh window - is the one most likely to be holding writes the server has never
   * seen. Wiping here would destroy them with no dialog and no way back, which is exactly
   * what `docs/design/02-offline-and-sync.md` §5.3 rules out on the analogous resync path:
   * a stale-but-intact local database beats a clean one missing the user's work. Those
   * rows stay, they push after a re-login as the same user, and `localStore.adopt` is what
   * stops them reaching a different one. Pinned by `AUTH-12`.
   */
  async function discard(expired: boolean): Promise<void> {
    // First, and synchronously: from this line on, nothing sent under the old session may
    // be retried under whatever replaces it. If the clear below throws, the epoch has
    // still moved, which fails closed - an in-flight request is surfaced rather than
    // replayed.
    epoch += 1;
    await tokenStore.clear();
    session = null;
    publish({ status: 'anonymous', expired });
  }

  async function performRefresh(): Promise<string | null> {
    const current = session;
    if (current === null) return null;
    const startedIn = epoch;

    try {
      const pair = await refreshTokens(current.refreshToken);
      // The session this refresh was for is gone. Persisting its rotated pair now would
      // overwrite whoever signed in while the request was away - user A's tokens
      // installed over user B's session, with B's user id attached to neither.
      if (epoch !== startedIn) return null;
      // A rotated pair carries no user; the owner is the one being refreshed. It cannot
      // have changed - a different user means a different sign-in, which goes through
      // `signIn`.
      await persist(sessionFromTokenPair(pair, current.userId, clock()));
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
      // Belt and braces, before the first screen can read: the store is normally stamped
      // at sign-in, so this is a no-op whose job is the cases where it is not - a database
      // restored from a backup beside somebody else's tokens, or one written before the
      // owner was recorded at all.
      if (session !== null) await localStore.adopt(session.userId);
      publish({
        status: session === null ? 'anonymous' : 'authenticated',
        expired: false,
      });
      return snapshot;
    },

    async getAccessToken() {
      return session?.accessToken ?? null;
    },

    getEpoch: () => epoch,

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

    async signIn(auth) {
      // Adopt before the publish, never after. The publish `authenticated`, the route
      // guards then let the tab bar mount, and its screens read SQLite on their first
      // frame - so a store adopted afterwards is a store the new user has already been
      // shown the previous user's expenses out of. Adopting first also means a failure
      // here leaves the user anonymous with their predecessor's data untouched, rather
      // than signed in over it.
      //
      // The whole `user` is passed, not just the id, so the profile row lands in the same
      // transaction as the wipe and the stamp (`docs/design/03-auth.md` §1.2 rule 7).
      // That matters for the same reason the ordering does: the first screen behind the
      // gate formats amounts with `user.currency`, and a store that is adopted but has no
      // profile yet would render that frame with no currency at all.
      //
      // But the tokens are written before the adopt (`AUTH-20`): `adopt` is the destructive
      // step - for a different user it deletes the previous account's undrained work - and a
      // keystore that cannot store the tokens must not be what triggers it. A failed write
      // throws here with the previous account's data untouched; a failed adopt takes the
      // freshly written tokens back out, so the store never claims a session whose rows were
      // not made safe to read.
      const next = sessionFromTokenPair(auth, auth.user.id, clock());
      await tokenStore.write(next);
      try {
        await localStore.adopt(auth.user.id, auth.user);
      } catch (error) {
        await tokenStore.clear().catch(() => undefined);
        throw error;
      }
      // After `adopt`, so a failed adoption leaves the old session's requests retryable,
      // and before the publish, so every listener woken by it already sees the new epoch.
      epoch += 1;
      session = next;
      publish({ status: 'authenticated', expired: false });
    },

    async adoptTokenPair(pair) {
      const current = session;
      if (current === null) return;
      await persist(sessionFromTokenPair(pair, current.userId, clock()));
    },

    async signOut() {
      // The token has to be read before `discard` forgets it, and the request is fired
      // rather than awaited - see `revokeRefreshToken`.
      const refreshToken = session?.refreshToken;
      if (refreshToken !== undefined && revokeRefreshToken !== undefined) {
        void revokeRefreshToken(refreshToken).catch(() => undefined);
      }
      // Tokens first, then the rows - the order `04-expense-list.md` rule 14 states, and
      // the one that degrades best: the user's contract with the Log out button is "I am
      // out", and a failed `DELETE` must not be what keeps them signed in. If the wipe
      // does fail, the leftover rows are now unowned, and the next `adopt` deletes them
      // before anyone can read them.
      await discard(false);
      await localStore.clear();
    },
  };
}
