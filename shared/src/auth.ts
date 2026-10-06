import { z } from 'zod';
import { CurrencyCode, Timestamp } from './primitives.js';
import { Email, Password, User } from './user.js';

/**
 * Auth is email + password with an access/refresh pair.
 *
 * The refresh token is long-lived on purpose: an offline-first app must not log the
 * user out because they were offline for a week. It is stored server-side as a hash so
 * it can be revoked, and it rotates on every use.
 */

export const SignupRequest = z.strictObject({
  email: Email,
  password: Password,
  currency: CurrencyCode.optional().describe(
    'Currency for this account, captured once at signup. Defaults to "USD" when omitted. Not changeable in the MVP.',
  ),
});

export const LoginRequest = z.strictObject({
  email: Email,
  password: Password,
});

export const RefreshToken = z
  .string()
  .min(1)
  .max(512)
  .describe(
    'Opaque refresh token. Single-use: a successful refresh revokes it and issues a new one. Replaying a rotated token returns `token_invalid`.',
  );

export const RefreshRequest = z.strictObject({
  refreshToken: RefreshToken,
});

export const LogoutRequest = z.strictObject({
  refreshToken: RefreshToken,
});

/** A freshly issued access + refresh pair. */
export const TokenPair = z.strictObject({
  accessToken: z
    .string()
    .describe(
      'Short-lived JWT. Send as `Authorization: Bearer <accessToken>` on every other endpoint.',
    ),
  refreshToken: RefreshToken,
  accessTokenExpiresIn: z
    .int()
    .min(1)
    .describe('Lifetime of `accessToken` in seconds from now (3600 = 1 hour).'),
  refreshTokenExpiresAt: Timestamp.describe(
    'Absolute expiry of `refreshToken` (60 days out). After this the user must log in again.',
  ),
});

/** Response to signup and login: the new session plus the user it belongs to. */
export const AuthResponse = z.strictObject({
  user: User,
  ...TokenPair.shape,
});

/** Response to refresh: a rotated pair. The previous refresh token is now revoked. */
export const RefreshResponse = TokenPair;

export type SignupRequest = z.infer<typeof SignupRequest>;
export type LoginRequest = z.infer<typeof LoginRequest>;
export type RefreshRequest = z.infer<typeof RefreshRequest>;
export type LogoutRequest = z.infer<typeof LogoutRequest>;
export type TokenPair = z.infer<typeof TokenPair>;
export type AuthResponse = z.infer<typeof AuthResponse>;
export type RefreshResponse = z.infer<typeof RefreshResponse>;

/** Default currency applied when `SignupRequest.currency` is omitted. */
export const DEFAULT_CURRENCY = 'USD' satisfies z.infer<typeof CurrencyCode>;
