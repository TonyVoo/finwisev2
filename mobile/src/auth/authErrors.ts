import type { ErrorCode } from '@expense-tracker/shared';
import { ApiRequestError, NetworkUnavailableError } from '../api/errors';
import { GENERIC_ERROR, OFFLINE_COPY } from '../copy/strings';

/**
 * Turns a failed signup or login into what the user sees.
 *
 * It is a pure function of the error, kept out of the screens because the thing it has
 * to get right is a *distinction*, not a message: "wrong password" and "no network" must
 * never render the same way (`TVO-10`). They arrive as different exception types -
 * {@link ApiRequestError} with `invalid_credentials` versus
 * {@link NetworkUnavailableError} - and a screen that caught `Error` and rendered one
 * string would collapse them. Here the two branches are visible side by side and
 * `tests/auth/authErrors.test.ts` pins them apart.
 *
 * Placement comes from `docs/design/03-auth.md` and the wording from
 * `docs/design/09-copy-deck.md` §2.
 */

/** The fields on these screens that own an error slot. */
export type AuthField = 'email' | 'password';

export interface AuthErrorPresentation {
  /** Errors to render in a field's helper slot, replacing its helper text. */
  readonly fieldErrors: Readonly<Partial<Record<AuthField, string>>>;
  /** Form-level banner copy, or null when the error was placed on a field. */
  readonly banner: string | null;
  /**
   * Whether to offer the `Log in instead` link below the Email field.
   *
   * Only `email_already_exists` sets it: the user has an account and the useful next
   * step is the other screen, carrying the email they already typed
   * (`03-auth.md` §1.2 rule 4).
   */
  readonly offerLogin: boolean;
}

/** Which screen is asking. Only the offline copy differs, and it differs on purpose. */
export type AuthScreen = 'signup' | 'login';

const BANNER_ONLY = (banner: string): AuthErrorPresentation => ({
  fieldErrors: {},
  banner,
  offerLogin: false,
});

/**
 * Codes with copy of their own on an auth screen.
 *
 * Everything else - including the five the deck marks *never shown*, which reaching here
 * would mean a client bug rather than a copy gap - falls back to {@link GENERIC_ERROR}.
 * The deck's rule 4 is the load-bearing one: an unrecognised code from a newer server
 * must render the generic copy, never the raw code.
 */
const BANNER_COPY: Partial<Record<ErrorCode, string>> = {
  invalid_credentials: 'That email or password is incorrect.',
  rate_limited: 'Too many attempts. Try again in a moment.',
};

const EMAIL_TAKEN = 'That email is already registered.';

/**
 * Map one `validation_error` issue path onto a field.
 *
 * The server's paths are dotted (`body.email`), so only the last segment is matched.
 * `currency` deliberately does not map: it is chosen from a fixed list of ten codes, so
 * a validation failure on it is a client bug rather than something the user mistyped,
 * and there is no error slot specified under the select for it. It falls through to the
 * banner, which is what `03-auth.md` §1.2 rule 5 asks for when a path matches no field
 * on screen.
 */
function fieldForPath(path: string): AuthField | null {
  const leaf = path.split('.').pop() ?? '';
  return leaf === 'email' || leaf === 'password' ? leaf : null;
}

export function presentAuthError(error: unknown, screen: AuthScreen): AuthErrorPresentation {
  // The request never reached a server. This is the one screen where that genuinely
  // blocks the user, and the copy says which action is blocked rather than announcing
  // that the network is down.
  if (error instanceof NetworkUnavailableError) {
    return BANNER_ONLY(OFFLINE_COPY[screen]);
  }

  if (!(error instanceof ApiRequestError)) {
    // A ResponseShapeError or a programming fault. The user cannot act on either, and
    // neither is their doing.
    return BANNER_ONLY(GENERIC_ERROR);
  }

  if (error.code === 'email_already_exists') {
    return { fieldErrors: { email: EMAIL_TAKEN }, banner: null, offerLogin: true };
  }

  if (error.code === 'validation_error') {
    const fieldErrors: Partial<Record<AuthField, string>> = {};
    let unplaced = false;

    for (const issue of error.details?.issues ?? []) {
      const field = fieldForPath(issue.path);
      // First issue per field wins. The spec announces the *first* field in error, and
      // a later issue overwriting an earlier one would move the message out from under
      // the field focus has already landed on.
      if (field === null) unplaced = true;
      else if (fieldErrors[field] === undefined) fieldErrors[field] = issue.message;
    }

    // A 400 with no usable issues at all still has to say something, or the user taps
    // Submit and watches nothing happen.
    const nothingPlaced = Object.keys(fieldErrors).length === 0;
    return {
      fieldErrors,
      banner: unplaced || nothingPlaced ? GENERIC_ERROR : null,
      offerLogin: false,
    };
  }

  return BANNER_ONLY(BANNER_COPY[error.code as ErrorCode] ?? GENERIC_ERROR);
}
