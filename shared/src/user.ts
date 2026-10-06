import { z } from 'zod';
import { CurrencyCode, LIMITS, Timestamp, Uuid } from './primitives.js';

/** Email address. The server lowercases and trims before storing and comparing. */
export const Email = z
  .email()
  .max(LIMITS.EMAIL_MAX)
  .describe(
    'Email address. Normalised server-side (trimmed and lowercased) before storage and comparison, so "A@x.com" and "a@x.com" are the same account.',
  );

export const Password = z
  .string()
  .min(LIMITS.PASSWORD_MIN)
  .max(LIMITS.PASSWORD_MAX)
  .describe(
    'Plaintext password, 8-128 characters. Sent only over TLS and hashed with argon2id server-side; never stored or logged.',
  );

/**
 * The authenticated user as returned on the wire.
 *
 * Note there is no `userId` field anywhere in this API's request bodies: tenancy comes
 * from the access token, so no endpoint can be pointed at another user's data.
 */
export const User = z.strictObject({
  id: Uuid,
  email: Email,
  currency: CurrencyCode.describe(
    "The user's single currency, captured at signup. Every expense of this user defaults to it.",
  ),
  createdAt: Timestamp,
});

export const MeResponse = z.strictObject({
  user: User,
});

export type Email = z.infer<typeof Email>;
export type Password = z.infer<typeof Password>;
export type User = z.infer<typeof User>;
export type MeResponse = z.infer<typeof MeResponse>;
