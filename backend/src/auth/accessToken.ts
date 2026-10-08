import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { getConfig } from '../config.ts';
import { problems } from '../errors.ts';

/**
 * Access tokens: short-lived HS256 JWTs carrying nothing but the user id.
 *
 * `sub` is the only claim that matters, and it is the *only* place a `userId` ever
 * enters this server — see `docs/PLAN.md` §3 (Tenancy). No request body, query
 * parameter or path segment in the API carries one, so an endpoint cannot be pointed at
 * another user's rows.
 *
 * `iss`/`aud` are pinned and verified so a token minted by some other service that
 * happens to share the secret cannot be replayed here.
 */

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getConfig().jwt.secret);
}

export interface AccessTokenResult {
  readonly token: string;
  /** Seconds until expiry, for `TokenPair.accessTokenExpiresIn`. */
  readonly expiresInSeconds: number;
}

/**
 * Mint an access token for a user.
 *
 * `ttlSecondsOverride` exists so a test can mint an already-expired token and assert
 * the `token_expired` path, which is otherwise untestable without waiting an hour.
 */
export async function signAccessToken(
  userId: string,
  ttlSecondsOverride?: number,
): Promise<AccessTokenResult> {
  const { jwt } = getConfig();
  const ttl = ttlSecondsOverride ?? jwt.accessTokenTtlSeconds;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(jwt.issuer)
    .setAudience(jwt.audience)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttl)
    .sign(secretKey());

  return { token, expiresInSeconds: ttl };
}

/**
 * Verify an access token and return its `sub`.
 *
 * Throws the contract's `token_expired` / `token_invalid` rather than a jose error, so
 * the client can tell "refresh and retry" from "re-login" — that distinction is the
 * whole reason the two codes exist.
 */
export async function verifyAccessToken(token: string): Promise<string> {
  const { jwt } = getConfig();
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: jwt.issuer,
      audience: jwt.audience,
      algorithms: ['HS256'],
    });
    const subject = payload.sub;
    if (typeof subject !== 'string' || subject.length === 0) {
      throw problems.tokenInvalid('Access token has no subject.');
    }
    return subject;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw problems.tokenExpired('Access token has expired.');
    }
    if (error instanceof joseErrors.JOSEError) {
      throw problems.tokenInvalid('Access token is not valid.');
    }
    throw error;
  }
}
