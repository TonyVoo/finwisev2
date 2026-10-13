import { Email, LIMITS } from '@expense-tracker/shared';
import { VALIDATION_COPY } from '../copy/strings';
import type { AuthField } from './authErrors';

/**
 * Client-side validation for the two auth forms.
 *
 * **Signup and login validate differently, on purpose** (`docs/design/03-auth.md` §1.2
 * rule 3 and §1.3 rule 1):
 *
 * - Signup states the requirements, because the user is choosing a value and needs to
 *   know what will be accepted.
 * - Login checks **presence only**. It never checks email format or password length -
 *   rejecting a credential the server might accept locks a user out of their own
 *   account, and refusing a 6-character password tells an attacker the stored one is
 *   longer than that. Both are the client inventing a rule the contract does not have.
 *
 * The email check runs through the shared `Email` schema rather than a hand-rolled
 * regex, so "valid" means exactly what the server means by it - including the trim that
 * schema performs ahead of the format check, which is why a keyboard that autocompletes
 * an address with a trailing space does not get a 400.
 */

export type FieldErrors = Readonly<Partial<Record<AuthField, string>>>;

export interface ValidationResult {
  readonly errors: FieldErrors;
  /**
   * The values to send, normalised. The email is the trimmed one the shared schema
   * accepted, so the request body carries what was validated rather than what was typed.
   */
  readonly values: { readonly email: string; readonly password: string };
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** Order matters: the first field in error is the one that takes focus. */
export const FIELD_ORDER: readonly AuthField[] = ['email', 'password'];

/** The first field carrying an error, in visual order, or null when there is none. */
export function firstFieldInError(errors: FieldErrors): AuthField | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

export function validateSignup({ email, password }: Credentials): ValidationResult {
  const errors: Partial<Record<AuthField, string>> = {};
  const parsed = Email.safeParse(email);

  if (!parsed.success) {
    // One message for both "empty" and "malformed": on signup the user is composing a
    // value, and `03-auth.md` §1.2 rule 3 maps the whole rule to this string.
    errors.email = VALIDATION_COPY.email.invalid;
  }

  // Measured on the raw string - the contract does not trim passwords, and trimming one
  // here would accept a password the server then rejects. An empty password is simply
  // shorter than the minimum, so it reads as the requirement rather than a scolding.
  if (password.length < LIMITS.PASSWORD_MIN) {
    errors.password = VALIDATION_COPY.password.short;
  } else if (password.length > LIMITS.PASSWORD_MAX) {
    errors.password = VALIDATION_COPY.password.long;
  }

  return {
    errors,
    values: { email: parsed.success ? parsed.data : email.trim(), password },
  };
}

export function validateLogin({ email, password }: Credentials): ValidationResult {
  const errors: Partial<Record<AuthField, string>> = {};

  if (email.trim().length === 0) errors.email = VALIDATION_COPY.email.empty;
  if (password.length === 0) errors.password = VALIDATION_COPY.password.empty;

  return { errors, values: { email: email.trim(), password } };
}
