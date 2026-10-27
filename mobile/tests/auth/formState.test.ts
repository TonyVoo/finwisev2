import { presentAuthError } from '@/auth/authErrors';
import {
  type AuthFormAction,
  type AuthFormState,
  authFormReducer,
  initialAuthFormState,
} from '@/auth/formState';
import { validateLogin, validateSignup } from '@/auth/validation';
import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
import { COPY, VALIDATION_COPY } from '@/copy/strings';

const GENERIC_ERROR = COPY.error.generic;

/**
 * Validation *timing* - `docs/design/03-auth.md` §1.2 rule 2.
 *
 * > A field is validated on blur, and re-validated on every keystroke **only after** it
 * > has first shown an error.
 *
 * Both naive implementations fail a user and neither failure is visible in a screenshot,
 * which is why this is a reducer with a test that plays keystrokes through it rather than
 * three `useState` calls in a screen:
 *
 * - validating on every keystroke says "Enter a valid email address." after the letter
 *   `a`;
 * - validating only on blur leaves an error the user has already fixed on screen until
 *   they leave the field again.
 */

/** Play a sequence of actions through the reducer with one validator. */
function run(
  validate: typeof validateSignup,
  actions: readonly AuthFormAction[],
  from: AuthFormState = initialAuthFormState(),
): AuthFormState {
  return actions.reduce((state, action) => authFormReducer(state, action, validate), from);
}

const type = (field: 'email' | 'password', value: string): AuthFormAction => ({
  kind: 'change',
  field,
  value,
});

describe('before a field has shown an error', () => {
  it('says nothing while the user is still typing an email for the first time', () => {
    const state = run(validateSignup, [
      type('email', 'a'),
      type('email', 'ad'),
      type('email', 'ada'),
      type('email', 'ada@'),
    ]);

    // Every one of those is an invalid email. Saying so would be correct and useless.
    expect(state.errors).toEqual({});
  });

  it('says nothing while the user is still typing a password for the first time', () => {
    const state = run(validateSignup, [type('password', 'a'), type('password', 'ab')]);

    expect(state.errors).toEqual({});
  });
});

describe('on blur', () => {
  it('shows the error for a field the user left in a bad state', () => {
    const state = run(validateSignup, [type('email', 'ada@'), { kind: 'blur', field: 'email' }]);

    expect(state.errors).toEqual({ email: VALIDATION_COPY.email.invalid });
  });

  it('stays silent about a field the user left in a good state', () => {
    const state = run(validateSignup, [
      type('email', 'ada@example.com'),
      { kind: 'blur', field: 'email' },
    ]);

    expect(state.errors).toEqual({});
    // And it does not go live: nothing was shown, so there is nothing for the user to
    // watch clear as they type.
    expect(state.live.email).toBeUndefined();
  });

  it('does not show an error for a different field', () => {
    // Leaving Email must not announce that Password is empty - the user has not reached
    // it yet.
    const state = run(validateSignup, [type('email', 'ada@'), { kind: 'blur', field: 'email' }]);

    expect(state.errors.password).toBeUndefined();
  });

  it('leaves an empty untouched field alone when another field blurs', () => {
    const state = run(validateSignup, [{ kind: 'blur', field: 'email' }]);

    expect(state.errors.password).toBeUndefined();
  });
});

describe('after a field has shown an error', () => {
  const afterEmailError = [
    type('email', 'ada@'),
    { kind: 'blur' as const, field: 'email' as const },
  ];

  it('clears the error as the user fixes it, without waiting for another blur', () => {
    const state = run(validateSignup, [...afterEmailError, type('email', 'ada@example.com')]);

    expect(state.errors).toEqual({});
  });

  it('brings the error back if the fix is undone', () => {
    const state = run(validateSignup, [
      ...afterEmailError,
      type('email', 'ada@example.com'),
      type('email', 'ada@example'),
    ]);

    expect(state.errors).toEqual({ email: VALIDATION_COPY.email.invalid });
  });

  it('stays live for the rest of the life of the form', () => {
    const state = run(validateSignup, [...afterEmailError, type('email', 'ada@example.com')]);

    expect(state.live.email).toBe(true);
  });

  it('still says nothing about a field that has never shown an error', () => {
    // The flag is per field, not per form.
    const state = run(validateSignup, [...afterEmailError, type('password', 'ab')]);

    expect(state.errors.password).toBeUndefined();
  });
});

describe('on submit', () => {
  it('validates every field, including ones never touched', () => {
    // Why the button is never disabled (§1.2 rule 1): tapping it on an empty form is how
    // the user finds out what is wrong.
    const state = run(validateSignup, [{ kind: 'submit' }]);

    expect(state.errors).toEqual({
      email: VALIDATION_COPY.email.invalid,
      password: VALIDATION_COPY.password.short,
    });
  });

  it('asks focus to move to the first field in error, not to all of them', () => {
    // §1.2 Accessibility: errors are never announced as a batch.
    const state = run(validateSignup, [{ kind: 'submit' }]);

    expect(state.focusRequest).toBe('email');
  });

  it('asks focus to move to Password when only Password is wrong', () => {
    const state = run(validateSignup, [type('email', 'ada@example.com'), { kind: 'submit' }]);

    expect(state.focusRequest).toBe('password');
  });

  it('requests no focus move when the form is valid', () => {
    const state = run(validateSignup, [
      type('email', 'ada@example.com'),
      type('password', 'correct horse'),
      { kind: 'submit' },
    ]);

    expect(state.errors).toEqual({});
    expect(state.focusRequest).toBeNull();
  });

  it('releases the focus request once the screen has acted on it', () => {
    const state = run(validateSignup, [{ kind: 'submit' }, { kind: 'focusHandled' }]);

    // Otherwise a re-render would steal focus back from wherever the user moved it.
    expect(state.focusRequest).toBeNull();
  });

  it('drops a stale banner from the previous attempt', () => {
    const failed = run(validateLogin, [
      type('email', 'ada@example.com'),
      type('password', 'wrong'),
      {
        kind: 'failed',
        presentation: presentAuthError(new NetworkUnavailableError(null), 'login'),
      },
    ]);
    expect(failed.banner).not.toBeNull();

    const retried = authFormReducer(failed, { kind: 'submit' }, validateLogin);

    // A new attempt supersedes the last failure.
    expect(retried.banner).toBeNull();
  });
});

describe('when the server answers a failure', () => {
  const signedUpWith = [
    type('email', 'ada@example.com'),
    type('password', 'correct horse'),
    { kind: 'submit' as const },
  ];

  it('places a duplicate-email error on the field and offers the login link', () => {
    const duplicate = new ApiRequestError({
      status: 409,
      code: 'email_already_exists',
      message: 'log line',
    });

    const state = run(validateSignup, [
      ...signedUpWith,
      { kind: 'failed', presentation: presentAuthError(duplicate, 'signup') },
    ]);

    expect(state.errors.email).toBe('That email is already registered.');
    expect(state.offerLogin).toBe(true);
    expect(state.banner).toBeNull();
  });

  it('withdraws the login link once the user types a different address', () => {
    const duplicate = new ApiRequestError({
      status: 409,
      code: 'email_already_exists',
      message: 'log line',
    });

    const state = run(validateSignup, [
      ...signedUpWith,
      { kind: 'failed', presentation: presentAuthError(duplicate, 'signup') },
      type('email', 'ada2@example.com'),
    ]);

    // The suggestion referred to *that* address being taken. With the error gone it has
    // nothing left to refer to.
    expect(state.errors.email).toBeUndefined();
    expect(state.offerLogin).toBe(false);
  });

  it('keeps the password on a failed attempt', () => {
    const wrong = new ApiRequestError({
      status: 401,
      code: 'invalid_credentials',
      message: 'log line',
    });

    const state = run(validateLogin, [
      type('email', 'ada@example.com'),
      type('password', 'hunter2'),
      { kind: 'submit' },
      { kind: 'failed', presentation: presentAuthError(wrong, 'login') },
    ]);

    // §1.2 rule 10: clearing it is a punishment for a typo in a different field.
    expect(state.values.password).toBe('hunter2');
    expect(state.values.email).toBe('ada@example.com');
  });

  it('keeps the values when the attempt was made offline', () => {
    const state = run(validateSignup, [
      ...signedUpWith,
      {
        kind: 'failed',
        presentation: presentAuthError(new NetworkUnavailableError(null), 'signup'),
      },
    ]);

    expect(state.values).toEqual({ email: 'ada@example.com', password: 'correct horse' });
    expect(state.banner).toBe('You need to be online to create an account.');
    // Nothing on a field: being offline is not a problem with the email the user typed.
    expect(state.errors).toEqual({});
  });

  it('does not move focus for a form-level banner', () => {
    const state = run(validateLogin, [
      type('email', 'ada@example.com'),
      type('password', 'hunter2'),
      { kind: 'submit' },
      {
        kind: 'failed',
        presentation: presentAuthError(new NetworkUnavailableError(null), 'login'),
      },
    ]);

    // The banner announces itself; `03-auth.md` §1.3 keeps focus on the Email field.
    expect(state.focusRequest).toBeNull();
  });

  it('shows a server field error live, so fixing it clears the message', () => {
    const invalid = new ApiRequestError({
      status: 400,
      code: 'validation_error',
      message: 'log line',
      details: { issues: [{ path: 'body.email', message: 'Enter a valid email address.' }] },
    });

    const failed = run(validateSignup, [
      ...signedUpWith,
      { kind: 'failed', presentation: presentAuthError(invalid, 'signup') },
    ]);
    expect(failed.errors.email).toBe('Enter a valid email address.');

    const typing = authFormReducer(failed, type('email', 'ada@elsewhere.com'), validateSignup);

    expect(typing.errors.email).toBeUndefined();
  });

  it('replaces client errors rather than merging with them', () => {
    // The request was sent, so the client's view of validity was accepted; what is on
    // screen now is what the server said.
    const serverFault = new ApiRequestError({
      status: 500,
      code: 'internal_error',
      message: 'log line',
    });

    const state = run(validateSignup, [
      type('email', 'ada@'),
      { kind: 'blur', field: 'email' },
      { kind: 'failed', presentation: presentAuthError(serverFault, 'signup') },
    ]);

    expect(state.errors).toEqual({});
    expect(state.banner).toBe(GENERIC_ERROR);
  });
});

describe('login prefilled from the signup screen', () => {
  it('starts with the email already typed and no errors', () => {
    // §1.2 rule 4 carries the address over so only the password is needed.
    const state = initialAuthFormState('ada@example.com');

    expect(state.values).toEqual({ email: 'ada@example.com', password: '' });
    expect(state.errors).toEqual({});
    expect(state.live).toEqual({});
  });
});
