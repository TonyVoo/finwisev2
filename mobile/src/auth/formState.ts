import type { AuthErrorPresentation, AuthField } from './authErrors';
import {
  type Credentials,
  FIELD_ORDER,
  type FieldErrors,
  type ValidationResult,
  firstFieldInError,
} from './validation';

/**
 * When an auth form shows an error, and when it stops.
 *
 * This is the part of `docs/design/03-auth.md` §1.2 rule 2 that is easy to get subtly
 * wrong and impossible to see in a screenshot:
 *
 * > A field is validated **on blur**, and re-validated on every keystroke *only after* it
 * > has first shown an error - so an error clears as the user fixes it but never appears
 * > while they are still typing the value for the first time.
 *
 * The naive implementations both fail. Validating on every keystroke tells someone their
 * email is invalid after they have typed `a`. Validating only on blur means an error the
 * user has already fixed stays on screen until they leave the field again. So each field
 * carries a **live** flag: false until an error has been shown for it, true forever
 * after, and only live fields re-validate as the user types.
 *
 * It is a reducer rather than a pile of `useState` calls because that is what makes the
 * rule testable - `tests/auth/formState.test.ts` plays keystrokes and blurs through it
 * with nothing rendered - and because "which field is in error" and "is the banner still
 * showing" are one state that must change together.
 */

export interface AuthFormState {
  readonly values: Credentials;
  /**
   * Fields that have shown an error at least once, and so now re-validate on every
   * keystroke. One-way: a field that goes live stays live for the life of the form.
   */
  readonly live: Readonly<Partial<Record<AuthField, true>>>;
  /** Errors currently on screen, field by field. */
  readonly errors: FieldErrors;
  /** Form-level banner copy, or null. */
  readonly banner: string | null;
  /** Whether to offer the `Log in instead` link (`§1.2` rule 4). */
  readonly offerLogin: boolean;
  /**
   * The field focus should move to, or null.
   *
   * Set by a submit that failed validation, because §1.2 Accessibility requires focus to
   * move to the *first* field in error and its message to be announced. It is cleared
   * once the screen has acted on it, so a re-render does not steal focus back.
   */
  readonly focusRequest: AuthField | null;
}

export type AuthFormAction =
  | { readonly kind: 'change'; readonly field: AuthField; readonly value: string }
  | { readonly kind: 'blur'; readonly field: AuthField }
  /** Submit pressed: validate everything, whether or not it has been touched. */
  | { readonly kind: 'submit' }
  /** The request came back a failure. */
  | { readonly kind: 'failed'; readonly presentation: AuthErrorPresentation }
  | { readonly kind: 'focusHandled' };

/** Validates a whole credential. `validateSignup` or `validateLogin`. */
export type Validator = (credentials: Credentials) => ValidationResult;

export function initialAuthFormState(email = ''): AuthFormState {
  return {
    values: { email, password: '' },
    live: {},
    errors: {},
    banner: null,
    offerLogin: false,
    focusRequest: null,
  };
}

/** Keep only the entries for fields that are live. */
function liveOnly(
  errors: FieldErrors,
  live: Readonly<Partial<Record<AuthField, true>>>,
): FieldErrors {
  const shown: Partial<Record<AuthField, string>> = {};
  for (const field of FIELD_ORDER) {
    const error = errors[field];
    if (error !== undefined && live[field] === true) shown[field] = error;
  }
  return shown;
}

export function authFormReducer(
  state: AuthFormState,
  action: AuthFormAction,
  validate: Validator,
): AuthFormState {
  switch (action.kind) {
    case 'change': {
      const values = { ...state.values, [action.field]: action.value };
      // Only live fields re-validate. A field the user is typing into for the first time
      // stays silent, which is the whole point of the flag.
      const errors = liveOnly(validate(values).errors, state.live);

      return {
        ...state,
        values,
        errors,
        // The link is tied to the Email error that justified it: once that error is gone -
        // because the user typed a different address - the suggestion to log in instead
        // no longer has anything to refer to.
        offerLogin: state.offerLogin && errors.email !== undefined,
        // The banner is *not* cleared here. It describes an attempt that really happened,
        // and the user has not made another one yet; clearing it as they retype would
        // erase the only record of why the last attempt failed.
        banner: state.banner,
      };
    }

    case 'blur': {
      const error = validate(state.values).errors[action.field];
      // Blur with no error does not make the field live: nothing has been shown, so
      // there is nothing for the user to watch clear as they type.
      if (error === undefined) return { ...state, errors: liveOnly(state.errors, state.live) };

      const live = { ...state.live, [action.field]: true } as const;
      return { ...state, live, errors: { ...state.errors, [action.field]: error } };
    }

    case 'submit': {
      // Every field, touched or not: tapping Submit with an empty form is how the user
      // finds out what is wrong, which is why the button is never disabled (§1.2 rule 1).
      const { errors } = validate(state.values);
      const live = { ...state.live } as Partial<Record<AuthField, true>>;
      for (const field of FIELD_ORDER) {
        if (errors[field] !== undefined) live[field] = true;
      }

      return {
        ...state,
        live,
        errors,
        // A new attempt supersedes the last failure, so the stale banner goes.
        banner: null,
        offerLogin: false,
        // Errors are never announced as a batch (§1.2 Accessibility): focus moves to the
        // first one and that message alone is read.
        focusRequest: firstFieldInError(errors),
      };
    }

    case 'failed': {
      const { fieldErrors, banner, offerLogin } = action.presentation;
      const live = { ...state.live } as Partial<Record<AuthField, true>>;
      for (const field of FIELD_ORDER) {
        if (fieldErrors[field] !== undefined) live[field] = true;
      }

      return {
        ...state,
        live,
        // Server-placed errors replace client ones rather than merging: the request was
        // sent, so the client's view of validity was accepted, and what is on screen now
        // is what the server said.
        errors: fieldErrors,
        banner,
        offerLogin,
        // A field error is worth moving focus to; a form-level banner is not - the banner
        // announces itself and `03-auth.md` §1.3 keeps focus on Email there.
        focusRequest: firstFieldInError(fieldErrors),
      };
    }

    case 'focusHandled':
      return { ...state, focusRequest: null };
  }
}
