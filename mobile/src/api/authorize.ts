import type { SessionController } from '../auth/session';
import type { Transport } from './transport';

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
 */
export function createAuthorizedTransport(
  transport: Transport,
  session: SessionController,
): Transport {
  return async function send(request) {
    // Signup, login, refresh and health take no token. Sending one would be harmless but
    // pointless, and a 401 from them is about the credentials in the body - refreshing
    // in response to a failed login makes no sense.
    if (!request.requiresAuth) {
      return transport(request);
    }

    const accessToken = await session.getAccessToken();
    const response = await transport({ ...request, accessToken });
    if (response.status !== 401) {
      return response;
    }

    const refreshed = await session.ensureFreshAccessToken(accessToken);
    if (refreshed === null || refreshed === accessToken) {
      return response;
    }

    return transport({ ...request, accessToken: refreshed });
  };
}
