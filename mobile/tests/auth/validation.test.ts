import { LIMITS } from '@expense-tracker/shared';
import { VALIDATION_COPY } from '@/copy/strings';
import { firstFieldInError, validateLogin, validateSignup } from '@/auth/validation';

/**
 * Client-side validation on the two auth forms.
 *
 * The thing worth testing here is not that an empty email is rejected — it is that
 * **signup and login reject different things**. `docs/design/03-auth.md` §1.3 rule 1 is
 * explicit that login checks presence only, because rejecting a credential the server
 * might accept locks a user out of their own account, and refusing a short password
 * tells an attacker that the stored one is longer. A single shared validator that "just
 * works" for both screens is the regression these cases exist to catch.
 */

describe('validateSignup', () => {
  it('accepts a well-formed credential', () => {
    const result = validateSignup({ email: 'ada@example.com', password: 'correct horse' });

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ email: 'ada@example.com', password: 'correct horse' });
  });

  it.each([
    ['empty', ''],
    ['no at sign', 'ada.example.com'],
    ['no domain', 'ada@'],
    ['spaces inside', 'ada example@example.com'],
    ['only whitespace', '   '],
  ])('rejects an email that is %s', (_case, email) => {
    expect(validateSignup({ email, password: 'correct horse' }).errors).toEqual({
      email: VALIDATION_COPY.email.invalid,
    });
  });

  it('states the requirement for a short password rather than scolding an empty one', () => {
    // One message for both, because on signup the user is composing a value: an empty
    // password is simply shorter than the minimum.
    expect(validateSignup({ email: 'ada@example.com', password: '' }).errors).toEqual({
      password: VALIDATION_COPY.password.short,
    });
    expect(validateSignup({ email: 'ada@example.com', password: 'a'.repeat(7) }).errors).toEqual({
      password: VALIDATION_COPY.password.short,
    });
  });

  it('accepts a password at exactly the minimum length', () => {
    const password = 'a'.repeat(LIMITS.PASSWORD_MIN);

    expect(validateSignup({ email: 'ada@example.com', password }).errors).toEqual({});
  });

  it('rejects a password one character over the maximum', () => {
    const atMax = 'a'.repeat(LIMITS.PASSWORD_MAX);
    expect(validateSignup({ email: 'ada@example.com', password: atMax }).errors).toEqual({});

    expect(validateSignup({ email: 'ada@example.com', password: `${atMax}a` }).errors).toEqual({
      password: VALIDATION_COPY.password.long,
    });
  });

  it('trims the email through the shared schema, so the body carries what was validated', () => {
    // A keyboard that autocompletes an address adds a trailing space. The shared `Email`
    // schema trims ahead of the format check, so this is valid, and the trimmed value is
    // what gets sent.
    const result = validateSignup({ email: '  ada@example.com  ', password: 'correct horse' });

    expect(result.errors).toEqual({});
    expect(result.values.email).toBe('ada@example.com');
  });

  it('does not trim the password', () => {
    // The contract does not trim passwords, so trimming here would accept a password the
    // server then rejects — and would silently change what the user typed.
    const result = validateSignup({ email: 'ada@example.com', password: '  spaces  ' });

    expect(result.values.password).toBe('  spaces  ');
    expect(result.errors).toEqual({});
  });

  it('reports both fields when both are wrong', () => {
    expect(validateSignup({ email: 'nope', password: 'short' }).errors).toEqual({
      email: VALIDATION_COPY.email.invalid,
      password: VALIDATION_COPY.password.short,
    });
  });

  it('never invents a password composition rule', () => {
    // §1.2 rule 3: the contract requires length only. A client that demands a digit or a
    // symbol is lying about what the server will accept.
    expect(validateSignup({ email: 'ada@example.com', password: 'aaaaaaaa' }).errors).toEqual({});
  });
});

describe('validateLogin', () => {
  it('accepts anything non-empty, including a credential signup would reject', () => {
    // The load-bearing case. This email does not parse and this password is 3
    // characters; an account created before a rule changed could legitimately have
    // either, and refusing to even attempt the login is how a user is locked out of
    // their own account (§1.3 rule 1).
    const result = validateLogin({ email: 'legacy-user', password: 'abc' });

    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ email: 'legacy-user', password: 'abc' });
  });

  it('asks for a missing email', () => {
    expect(validateLogin({ email: '', password: 'abc' }).errors).toEqual({
      email: VALIDATION_COPY.email.empty,
    });
  });

  it('treats a whitespace-only email as missing', () => {
    expect(validateLogin({ email: '   ', password: 'abc' }).errors).toEqual({
      email: VALIDATION_COPY.email.empty,
    });
  });

  it('asks for a missing password', () => {
    expect(validateLogin({ email: 'ada@example.com', password: '' }).errors).toEqual({
      password: VALIDATION_COPY.password.empty,
    });
  });

  it('does not treat a whitespace-only password as missing', () => {
    // Deliberate asymmetry with the email: ' ' is a plausible character of a real
    // password, and the client has no business deciding it is not one.
    expect(validateLogin({ email: 'ada@example.com', password: ' ' }).errors).toEqual({});
  });

  it('uses presence copy, not the signup requirement copy', () => {
    const errors = validateLogin({ email: '', password: '' }).errors;

    expect(errors.email).toBe(VALIDATION_COPY.email.empty);
    expect(errors.password).toBe(VALIDATION_COPY.password.empty);
    expect(errors.email).not.toBe(VALIDATION_COPY.email.invalid);
    expect(errors.password).not.toBe(VALIDATION_COPY.password.short);
  });

  it('trims the email it sends', () => {
    expect(validateLogin({ email: ' ada@example.com ', password: 'abc' }).values.email).toBe(
      'ada@example.com',
    );
  });
});

describe('firstFieldInError', () => {
  it('returns null when nothing is in error', () => {
    expect(firstFieldInError({})).toBeNull();
  });

  it('prefers email, which is the first field on screen', () => {
    // Focus moves to the *first* field in error (§1.2 Accessibility), so visual order
    // decides, not the order the errors happened to be written in.
    expect(firstFieldInError({ password: 'x', email: 'y' })).toBe('email');
  });

  it('falls through to password when email is clean', () => {
    expect(firstFieldInError({ password: 'x' })).toBe('password');
  });
});
