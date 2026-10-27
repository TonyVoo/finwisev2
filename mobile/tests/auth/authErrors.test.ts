import type { ErrorCode, ErrorDetails } from '@expense-tracker/shared';
import { ApiRequestError, NetworkUnavailableError, ResponseShapeError } from '@/api/errors';
import { presentAuthError } from '@/auth/authErrors';
import { COPY, OFFLINE_COPY } from '@/copy/strings';

const GENERIC_ERROR = COPY.error.generic;

/**
 * What a failed signup or login says to the user.
 *
 * The acceptance criterion this file exists for is a *distinction*, not a message:
 * **"wrong password" and "no network" must never look the same.** They arrive as
 * different exception types, and the easy mistake — one `catch (error)` rendering one
 * string — is invisible until a user is told their password is wrong while standing in
 * a lift. The last describe block pins the pairs apart directly.
 *
 * Wording comes from `docs/design/09-copy-deck.md` §2 and placement from
 * `03-auth.md` §1.2 rules 4-6 and §1.3 rules 2 and 6.
 */

function serverError(code: ErrorCode, status: number, details?: ErrorDetails): ApiRequestError {
  return new ApiRequestError({
    status,
    code,
    // Deliberately something a user must never see: the deck's §2.1 note 3 says the
    // server's own message is for logs. If this string ever surfaces in an assertion
    // below, the client is rendering it.
    message: 'internal diagnostic text',
    details,
  });
}

describe('transport failure', () => {
  it('names the action that is blocked on signup', () => {
    expect(presentAuthError(new NetworkUnavailableError(new Error('offline')), 'signup')).toEqual({
      fieldErrors: {},
      banner: OFFLINE_COPY.signup,
      offerLogin: false,
    });
  });

  it('names the action that is blocked on login', () => {
    expect(presentAuthError(new NetworkUnavailableError(new Error('offline')), 'login')).toEqual({
      fieldErrors: {},
      banner: OFFLINE_COPY.login,
      offerLogin: false,
    });
  });

  it('says which screen is blocked rather than announcing that the network is down', () => {
    const signup = presentAuthError(new NetworkUnavailableError(null), 'signup').banner;
    const login = presentAuthError(new NetworkUnavailableError(null), 'login').banner;

    // Offline is this app working as designed everywhere else, so these two strings are
    // specific on purpose (deck §0 rule 2, §2.3).
    expect(signup).not.toBe(login);
    expect(signup).toContain('create an account');
    expect(login).toContain('log in');
  });
});

describe('invalid_credentials', () => {
  it('renders a form-level banner and never a field error', () => {
    const presented = presentAuthError(serverError('invalid_credentials', 401), 'login');

    // §1.3 rule 2: a field-level error on Email would confirm whether an account exists.
    expect(presented).toEqual({
      fieldErrors: {},
      banner: 'That email or password is incorrect.',
      offerLogin: false,
    });
  });

  it('does not say which half was wrong', () => {
    const banner = presentAuthError(serverError('invalid_credentials', 401), 'login').banner ?? '';

    // It names both halves disjunctively, so it cannot be read as singling one out —
    // which is what would confirm whether an account exists for that email.
    expect(banner).toContain('email or password');
    expect(banner).toMatch(/\bemail\b/);
    expect(banner).toMatch(/\bpassword\b/);
  });
});

describe('email_already_exists', () => {
  it('puts the error on the Email field and offers the other screen', () => {
    expect(presentAuthError(serverError('email_already_exists', 409), 'signup')).toEqual({
      fieldErrors: { email: 'That email is already registered.' },
      banner: null,
      offerLogin: true,
    });
  });

  it('is the only code that offers the login link', () => {
    const others: ErrorCode[] = ['invalid_credentials', 'rate_limited', 'internal_error'];

    for (const code of others) {
      expect({ code, offerLogin: presentAuthError(serverError(code, 400), 'signup').offerLogin }) //
        .toEqual({ code, offerLogin: false });
    }
  });
});

describe('validation_error', () => {
  it('maps a dotted server path onto the field it names', () => {
    const details = { issues: [{ path: 'body.email', message: 'Enter a valid email address.' }] };

    expect(presentAuthError(serverError('validation_error', 400, details), 'signup')).toEqual({
      fieldErrors: { email: 'Enter a valid email address.' },
      banner: null,
      offerLogin: false,
    });
  });

  it('places an issue on each field it names', () => {
    const details = {
      issues: [
        { path: 'body.email', message: 'Email is wrong.' },
        { path: 'body.password', message: 'Password is wrong.' },
      ],
    };

    expect(
      presentAuthError(serverError('validation_error', 400, details), 'signup').fieldErrors,
    ).toEqual({ email: 'Email is wrong.', password: 'Password is wrong.' });
  });

  it('keeps the first issue per field', () => {
    // A later issue overwriting an earlier one would move the message out from under the
    // field that focus has already landed on.
    const details = {
      issues: [
        { path: 'body.email', message: 'First.' },
        { path: 'body.email', message: 'Second.' },
      ],
    };

    expect(
      presentAuthError(serverError('validation_error', 400, details), 'signup').fieldErrors.email,
    ).toBe('First.');
  });

  it('falls back to the banner for a path that matches no field on screen', () => {
    // §1.2 rule 5. `currency` is chosen from a fixed list, so a validation failure on it
    // is a client bug and there is no error slot under the select for it.
    const details = { issues: [{ path: 'body.currency', message: 'Bad currency.' }] };
    const presented = presentAuthError(serverError('validation_error', 400, details), 'signup');

    expect(presented).toEqual({ fieldErrors: {}, banner: GENERIC_ERROR, offerLogin: false });
  });

  it('still places the fields it can when one path is unplaceable', () => {
    const details = {
      issues: [
        { path: 'body.email', message: 'Email is wrong.' },
        { path: 'body.currency', message: 'Bad currency.' },
      ],
    };
    const presented = presentAuthError(serverError('validation_error', 400, details), 'signup');

    expect(presented.fieldErrors).toEqual({ email: 'Email is wrong.' });
    expect(presented.banner).toBe(GENERIC_ERROR);
  });

  it('never renders a raw path string', () => {
    const details = { issues: [{ path: 'body.currency', message: 'Bad currency.' }] };
    const presented = presentAuthError(serverError('validation_error', 400, details), 'signup');

    expect(JSON.stringify(presented)).not.toContain('body.currency');
  });

  it('says something when a 400 carries no issues at all', () => {
    // Otherwise the user taps Submit and watches nothing happen.
    for (const details of [undefined, { issues: [] }]) {
      expect(presentAuthError(serverError('validation_error', 400, details), 'signup')).toEqual({
        fieldErrors: {},
        banner: GENERIC_ERROR,
        offerLogin: false,
      });
    }
  });
});

describe('rate_limited', () => {
  it('renders the deck copy without a countdown', () => {
    const presented = presentAuthError(serverError('rate_limited', 429), 'login');

    expect(presented.banner).toBe('Too many attempts. Try again in a moment.');
    // §1.2 rule 6: deliberately vague rather than a timer the user must watch.
    expect(presented.banner).not.toMatch(/\d/);
  });
});

describe('everything else', () => {
  it.each<ErrorCode>(['internal_error', 'forbidden', 'malformed_request', 'immutable_field'])(
    'renders the generic copy for %s',
    (code) => {
      expect(presentAuthError(serverError(code, 500), 'login')).toEqual({
        fieldErrors: {},
        banner: GENERIC_ERROR,
        offerLogin: false,
      });
    },
  );

  it('renders the generic copy for an unrecognised code from a newer server', () => {
    // Deck §2.1 note 4. The raw code must never reach the banner.
    const error = new ApiRequestError({
      status: 418,
      code: 'teapot_overheated' as ErrorCode,
      message: 'internal diagnostic text',
    });
    const presented = presentAuthError(error, 'login');

    expect(presented.banner).toBe(GENERIC_ERROR);
    expect(presented.banner).not.toContain('teapot_overheated');
  });

  it('renders the generic copy for a contract break', () => {
    const presented = presentAuthError(new ResponseShapeError(200, 'user: required'), 'login');

    expect(presented).toEqual({ fieldErrors: {}, banner: GENERIC_ERROR, offerLogin: false });
  });

  it('renders the generic copy for a programming fault', () => {
    for (const thrown of [new TypeError('x is not a function'), 'a string', null, undefined]) {
      expect(presentAuthError(thrown, 'login').banner).toBe(GENERIC_ERROR);
    }
  });

  it('never renders the server message', () => {
    // The server's `message` is for logs (deck §2.1 note 3).
    const presented = presentAuthError(serverError('internal_error', 500), 'login');

    expect(JSON.stringify(presented)).not.toContain('internal diagnostic text');
  });
});

/**
 * The acceptance criterion, stated as assertions: these pairs must not look alike.
 */
describe('the distinctions that must hold', () => {
  const offline = presentAuthError(new NetworkUnavailableError(null), 'login');
  const wrongPassword = presentAuthError(serverError('invalid_credentials', 401), 'login');
  const serverFault = presentAuthError(serverError('internal_error', 500), 'login');

  it('tells a wrong password apart from no network', () => {
    expect(offline.banner).not.toBe(wrongPassword.banner);
  });

  it('tells a wrong password apart from a server fault', () => {
    expect(wrongPassword.banner).not.toBe(serverFault.banner);
  });

  it('tells no network apart from a server fault', () => {
    // One is the app working as designed and one is an outage; the deck's §0 rule 2 is
    // that we never apologise for the first.
    expect(offline.banner).not.toBe(serverFault.banner);
    expect(offline.banner).not.toContain('our end');
  });

  it('gives a duplicate email a different shape from a wrong password', () => {
    const duplicate = presentAuthError(serverError('email_already_exists', 409), 'signup');

    // Not just different copy: one is a field error with a way forward, the other is a
    // form banner with none.
    expect(duplicate.fieldErrors.email).toBeDefined();
    expect(duplicate.banner).toBeNull();
    expect(wrongPassword.fieldErrors).toEqual({});
    expect(wrongPassword.banner).not.toBeNull();
  });
});
