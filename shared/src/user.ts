import { z } from 'zod';
import { CurrencyCode, LIMITS, Timestamp, Uuid } from './primitives.js';

/**
 * Email address. The server lowercases and trims before storing and comparing.
 *
 * The trim is a `.pipe()` ahead of the format check rather than a check on `z.email()`,
 * because zod runs string-format validation first: `z.email().trim()` would reject
 * `" a@x.com "` as malformed before ever trimming it. A mobile keyboard that
 * autocompletes an address with a trailing space would then get a 400 on a perfectly
 * good login, so the order here is load-bearing. `max` sits after the trim so the limit
 * measures the address, not the padding.
 */
export const Email = z
  .string()
  .trim()
  .max(LIMITS.EMAIL_MAX)
  .pipe(z.email())
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
  emailVerified: z
    .boolean()
    .optional()
    .describe(
      'Whether the account has proved it can read its email address (by a verification code, or by completing a password reset). Absent from servers that predate verification; treat absent as `false`. Verification is advisory: an unverified account works in full.',
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
