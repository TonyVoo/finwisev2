import { ApiRequestError, NetworkUnavailableError } from '../api/errors';
import { COPY } from '../copy/strings';

/**
 * Turns a failed forgot-password or reset-password request into what the user sees.
 *
 * Pure, like `accountErrors.ts`, because the thing to get right is a distinction:
 *
 * - **A wrong, expired or used code** is a field error on Code, and the same sentence for
 *   all three - the server does not say which, and neither does the app.
 * - **Too many attempts** and **no network** are banners. Offline names the blocked action,
 *   as the other online-only screens do.
 * - **Anything else** is the generic banner. Never a raw code.
 *
 * `forgot-password` has no per-field failure: the server answers the same for every email.
 */
export type ResetAction = 'forgotPassword' | 'resetPassword';

export interface ResetErrorPresentation {
  readonly codeError: string | null;
  readonly banner: string | null;
}

export function presentResetError(error: unknown, action: ResetAction): ResetErrorPresentation {
  if (error instanceof NetworkUnavailableError) {
    return { codeError: null, banner: COPY[action].offline };
  }
  if (error instanceof ApiRequestError) {
    if (error.code === 'invalid_reset_code' && action === 'resetPassword') {
      return { codeError: COPY.resetPassword.invalidCode, banner: null };
    }
    if (error.code === 'rate_limited') {
      return { codeError: null, banner: COPY.account.tooManyAttempts };
    }
  }
  return { codeError: null, banner: COPY.error.generic };
}
