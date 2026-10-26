import type { Transport } from './transport';

/**
 * The two session members the interceptor calls, declared here rather than imported.
 *
 * `SessionController` in `auth/session.ts` satisfies this structurally, so the only
 * thing this changes is which direction the dependency points. It is the mirror of the
 * reason `SessionControllerOptions.refreshTokens` is injected rather than imported -
 * that keeps the session module off the API client - plus one that is measurable:
 * importing the type, even with `import type`, is erased at runtime but still resolved
 * by `tsc`, which puts `auth/session.ts` into the importing package's program. From
 * there it reached `auth/tokenStore.ts`, `expo-secure-store`, `expo-modules-core`,
 * `react-native` and `@types/jsdom`, which references `lib.dom`; with the DOM globals
 * loaded the backend failed its own typecheck in two files nobody touched (`TVO-23`).
 * Declaring the two methods instead is what lets
 * `backend/tests/integration.mobileClient.test.ts` drive the real interceptor against
 * the real server, which is where `API-19` lives.
 *
 * `TVO-33` has since cut that chain at the other end as well - `session.ts` now reaches
 * only `auth/sessionRecord.ts`, so it loads outside Expo too - but the direction of this
 * dependency is worth keeping regardless: the interceptor is the lower layer, and it
 * should not know what supplies its tokens.
 */
export interface TokenSource {
  /** The current access token, or null when there is no session. */
  getAccessToken(): Promise<string | null>;
  /**
   * Counter that moves when the session's identity changes (sign-in, sign-out, forced
   * clear) and not on a token rotation. Required rather than optional: a guard against
   * replaying one account's request into another is worthless if one forgotten
   * implementation silently opts out of it.
   */
  getEpoch(): number;
  /**
   * Obtain an access token newer than `staleAccessToken`, refreshing at most once across
   * all concurrent callers. Returns null when the session is gone.
   */
  ensureFreshAccessToken(staleAccessToken: string | null): Promise<string | null>;
}

/**
 * The 401 interceptor: attach the access token, and refresh once if it has expired.
 *
 * Access tokens live an hour and the app runs for days, so a 401 is a routine event, not
 * an error. Handling it here means no caller - no screen, no sync pass - ever has to
 * think about token lifetime.
 *
 * The rules, each of which is a bug if it is missing:
 *
 * 1. **Retry at most once.** A second 401 after a successful refresh is a real
 *    rejection, and retrying it again is an infinite loop against the server.
 * 2. **One refresh for many concurrent 401s.** Enforced by the session controller, which
 *    shares a single in-flight refresh. The refresh token is single-use and rotates, so
 *    two parallel rotations would have the second arrive already revoked and log the
 *    user out. See the comment on `inFlightRefresh` in `auth/session.ts`.
 * 3. **Retry only when the token actually changed.** If the refresh produced the same
 *    value, replaying the request would just 401 again.
 * 4. **Never swallow the 401.** When the session is gone, the original response is
 *    returned so the caller still sees a failure rather than an empty success.
 * 5. **Never retry across a session change** (`TVO-20`). The request's body was built
 *    for the account that sent it. If anyone signed in or out while it was away, the
 *    stored token belongs to a different session, and "the token changed, so retry"
 *    (rule 3) would replay one account's payload into another's - the server files user
 *    A's spending under user B. The epoch is read before the token and compared after
 *    every await that follows, including the refresh, because a refresh that finds a
 *    different stored token hands *that* token back as if it were a rotation.
 */
export function createAuthorizedTransport(transport: Transport, session: TokenSource): Transport {
  return async function send(request) {
    // Signup, login, refresh and health take no token. Sending one would be harmless but
    // pointless, and a 401 from them is about the credentials in the body - refreshing
    // in response to a failed login makes no sense.
    if (!request.requiresAuth) {
      return transport(request);
    }

    const epoch = session.getEpoch();
    const accessToken = await session.getAccessToken();
    const response = await transport({ ...request, accessToken });
    if (response.status !== 401) {
      return response;
    }
    if (session.getEpoch() !== epoch) {
      return response;
    }

    const refreshed = await session.ensureFreshAccessToken(accessToken);
    if (refreshed === null || refreshed === accessToken || session.getEpoch() !== epoch) {
      return response;
    }

    return transport({ ...request, accessToken: refreshed });
  };
}
