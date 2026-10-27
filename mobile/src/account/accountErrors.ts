import { ApiRequestError, NetworkUnavailableError } from '../api/errors';
import { COPY, GENERIC_ERROR } from '../copy/strings';

/**
 * Turns a failed change-password, change-email or delete-account request into what the user sees.
 *
 * A pure function of the error, for the same reason `authErrors.ts` is: the thing to get
 * right is a distinction, and three different failures are one lazy `catch` away from
 * rendering identically.
 *
 * - **A wrong password** is a field error on the field the user can fix. It arrives as
 *   `403 forbidden`, deliberately not a `401`: a `401` on an authenticated call makes the
 *   transport refresh and, failing that, sign the user out, and mistyping a password in
 *   Settings must never do that.
 * - **No network** names the blocked action. These two actions are the only ones in the app
 *   that are online-only, and the copy says so rather than announcing a dead network.
 * - **Anything else** is the generic banner. Never the raw code.
 */

export type AccountAction = 'changePassword' | 'changeEmail' | 'deleteAccount';

export interface AccountErrorPresentation {
  /** Error for the (current) password field, when the failure belongs there. */
  readonly passwordError: string | null;
  /** Form-level banner copy, or null when the error was placed on the field. */
  readonly banner: string | null;
  /** Error for the new-email field. Only change-email can produce one: the address is taken. */
  readonly emailError?: string;
}

export function presentAccountError(
  error: unknown,
  action: AccountAction,
): AccountErrorPresentation {
  if (error instanceof NetworkUnavailableError) {
    return { passwordError: null, banner: COPY.account[action].offline };
  }

  if (error instanceof ApiRequestError) {
    if (error.code === 'forbidden') {
      return { passwordError: COPY.account.wrongPassword, banner: null };
    }
    if (error.code === 'email_already_exists' && action === 'changeEmail') {
      return { passwordError: null, banner: null, emailError: COPY.account.changeEmail.taken };
    }
    if (error.code === 'rate_limited') {
      return { passwordError: null, banner: COPY.account.tooManyAttempts };
    }
  }

  return { passwordError: null, banner: GENERIC_ERROR };
}

export interface VerifyErrorPresentation {
  readonly codeError: string | null;
  readonly banner: string | null;
}

/**
 * The same distinction for verify-email: a wrong, expired or used code is a field error
 * (one sentence for all three), rate limiting and no network are banners, the rest generic.
 */
export function presentVerifyError(
  error: unknown,
  action: 'request' | 'confirm',
): VerifyErrorPresentation {
  if (error instanceof NetworkUnavailableError) {
    return { codeError: null, banner: COPY.verifyEmail.offline };
  }
  if (error instanceof ApiRequestError) {
    if (error.code === 'invalid_verification_code' && action === 'confirm') {
      return { codeError: COPY.verifyEmail.invalidCode, banner: null };
    }
    if (error.code === 'rate_limited') {
      return { codeError: null, banner: COPY.account.tooManyAttempts };
    }
  }
  return { codeError: null, banner: GENERIC_ERROR };
}
