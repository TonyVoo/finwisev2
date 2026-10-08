import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh tokens: opaque, single-use, stored only as a hash.
 *
 * Not a JWT, on purpose. A refresh token has to be *revocable* — rotation, logout and
 * reuse-detection all mean "this exact token is now dead" — and a self-contained JWT
 * cannot be revoked without a server-side list, at which point the JWT is doing no
 * work. So it is 32 bytes of CSPRNG output with a version prefix, and the server keeps
 * a row per live token.
 *
 * Only the SHA-256 of the token is stored, so a database dump cannot be replayed as a
 * session. SHA-256 and not argon2: unlike a password this is 256 bits of uniform
 * randomness, so there is no dictionary to slow an attacker down to, and the lookup is
 * on the hot path of every refresh.
 */

/** Version prefix, so a future format change is distinguishable rather than ambiguous. */
const PREFIX = 'v1.';

/** 256 bits. Far beyond guessing, and SHA-256 of it fits the `CHAR(64)` column. */
const TOKEN_BYTES = 32;

/** Mint a new refresh token. Returned once, in the response; never recoverable after. */
export function generateRefreshToken(): string {
  return `${PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

/** The value stored in `refresh_tokens.token_hash`: lowercase hex SHA-256, 64 chars. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compare two token hashes without leaking their difference through timing.
 *
 * The database lookup is by hash equality, so this is belt-and-braces for call sites
 * that compare in application code; both inputs are fixed-length hex of the same
 * length, so an unequal length means a bug rather than an attack.
 */
export function refreshTokenHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Absolute expiry for a freshly minted refresh token. */
export function refreshTokenExpiry(ttlDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}
