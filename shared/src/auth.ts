import { z } from 'zod';
import { SEED_LANGUAGES } from './category.js';
import { CurrencyCode, LIMITS, Timestamp } from './primitives.js';
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
  language: z
    .enum(SEED_LANGUAGES)
    .optional()
    .describe(
      'Language to name the seeded default categories in: `en` (the default) or `vi`. Only affects the names they are created with; the person can rename them.',
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

/**
 * A password being *presented* rather than chosen: no minimum, because the account's
 * existing password is checked against its hash, not against today's rules. An account
 * created under an older, weaker rule must still be able to confirm itself and change it.
 */
const PresentedPassword = z.string().min(1).max(LIMITS.PASSWORD_MAX);

export const ChangePasswordRequest = z
  .strictObject({
    currentPassword: PresentedPassword.describe("The account's current password, re-entered."),
    newPassword: Password,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ['newPassword'],
    message: 'The new password must be different from the current one.',
  });

export const ForgotPasswordRequest = z.strictObject({
  email: Email.describe(
    'The account to send a reset code to. The response is the same whether or not an account exists, so this cannot be used to find out.',
  ),
});

export const ResetCode = z
  .string()
  .regex(
    new RegExp(`^\\d{${LIMITS.RESET_CODE_LENGTH}}$`),
    `Exactly ${LIMITS.RESET_CODE_LENGTH} digits.`,
  )
  .describe(`The ${LIMITS.RESET_CODE_LENGTH}-digit code from the reset email.`);

export const ResetPasswordRequest = z.strictObject({
  email: Email,
  code: ResetCode,
  newPassword: Password,
});

/** No fields: the account is the caller's, and the address is its current one. */
export const RequestEmailVerificationRequest = z.strictObject({});

export const VerifyEmailRequest = z.strictObject({
  code: ResetCode.describe(
    "The 6-digit code emailed to the account's current address by `POST /v1/me/email-verification`.",
  ),
});

export const ChangeEmailRequest = z.strictObject({
  email: Email.describe(
    'The new sign-in email. Normalised like every other email; must not already belong to an account, and must differ from the current one.',
  ),
  password: PresentedPassword.describe(
    'The account password, re-entered: an email is what a password reset would be sent to, so a stolen access token alone must not be able to change it.',
  ),
});

export const DeleteAccountRequest = z.strictObject({
  password: PresentedPassword.describe(
    'The account password, re-entered. Deleting an account cannot be undone, so a stolen access token alone is not enough.',
  ),
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

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;
export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequest>;
export type RequestEmailVerificationRequest = z.infer<typeof RequestEmailVerificationRequest>;
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequest>;
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;
export type SignupRequest = z.infer<typeof SignupRequest>;
export type LoginRequest = z.infer<typeof LoginRequest>;
export type RefreshRequest = z.infer<typeof RefreshRequest>;
export type LogoutRequest = z.infer<typeof LogoutRequest>;
export type TokenPair = z.infer<typeof TokenPair>;
export type AuthResponse = z.infer<typeof AuthResponse>;
export type RefreshResponse = z.infer<typeof RefreshResponse>;

/** Default currency applied when `SignupRequest.currency` is omitted. */
export const DEFAULT_CURRENCY = 'USD' satisfies z.infer<typeof CurrencyCode>;
