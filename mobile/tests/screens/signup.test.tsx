import { screen, waitFor } from '@testing-library/react-native';
import { NetworkUnavailableError } from '@/api/errors';
import { OFFLINE_COPY, VALIDATION_COPY } from '@/copy/strings';
import { OWNER_KEY } from '@/db/localStore';
import { readUser } from '@/db/user';
import SignupScreen from '../../app/(auth)/signup';
import { resetRouter, routerRecord } from '../support/router';
import {
  apiError,
  authResponse,
  blur,
  mountScreen,
  ok,
  pressOn,
  secureStore,
  typeInto,
  type MountedScreen,
} from '../support/mount';

jest.mock('expo-router');

/**
 * Sign up, through the screen — `docs/design/03-auth.md` §1.2.
 *
 * The companion to `login.test.tsx`, covering the three things signup has that login does
 * not: validation that **states requirements** rather than checking presence, the
 * currency that cannot be changed afterwards, and `email_already_exists` — the one error
 * in the app that is both a field error and an offer to go somewhere else.
 *
 * The currency cases are the ones worth the most here. It is captured once and never
 * again, and it decides how every amount in the account is formatted for the rest of its
 * life — including whether the keypad has a decimal key at all, because `JPY` has no
 * minor unit. A screen that quietly dropped the field would be invisible until a Japanese
 * user's first expense came out a hundred times too large.
 */

const VALID = { email: 'ada@example.com', password: 'correct-horse' };

describe('the sign up screen', () => {
  let mounted: MountedScreen;

  beforeEach(() => {
    resetRouter();
    secureStore().clear();
  });

  afterEach(() => {
    mounted?.database.close();
  });

  async function submitForm({ email, password } = VALID): Promise<void> {
    await typeInto('signup-email', email);
    await typeInto('signup-password', password);
    await pressOn('signup-submit');
  }

  const authenticated = () =>
    waitFor(() => {
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
    });

  /** A transport that refuses to be called, for the cases that must not reach it. */
  const noNetwork = async () => {
    throw new Error('validation must fail before anything is sent');
  };

  describe('validation', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<SignupScreen />, { transport: noNetwork });
    });

    it('reveals every error when submitted empty', async () => {
      // §1.2 rule 1: submit is enabled from the first frame, and tapping it on an empty
      // form is how the user finds out what is required.
      await pressOn('signup-submit');

      expect(screen.getByText(VALIDATION_COPY.email.invalid)).toBeTruthy();
      expect(screen.getByText(VALIDATION_COPY.password.short)).toBeTruthy();
      expect(mounted.requests).toHaveLength(0);
    });

    it('states the length requirement rather than scolding an empty password', async () => {
      // One message for empty and for too-short, because on signup the user is composing
      // a value and the useful thing to say is what will be accepted (§1.2 rule 3).
      await typeInto('signup-email', VALID.email);
      await typeInto('signup-password', 'short');
      await pressOn('signup-submit');

      expect(screen.getByText(VALIDATION_COPY.password.short)).toBeTruthy();
      expect(mounted.requests).toHaveLength(0);
    });

    it('rejects a password over the contract maximum', async () => {
      await typeInto('signup-email', VALID.email);
      await typeInto('signup-password', 'a'.repeat(129));
      await pressOn('signup-submit');

      expect(screen.getByText(VALIDATION_COPY.password.long)).toBeTruthy();
      expect(mounted.requests).toHaveLength(0);
    });

    it('accepts a long passphrase with no symbols or digits', async () => {
      // §1.2 rule 3: "The client never checks password composition." The contract
      // requires length only, and inventing extra rules the server does not enforce makes
      // the client lie about what would be accepted.
      mounted.database.close();
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => ok(201, authResponse()),
      });

      await submitForm({ email: VALID.email, password: 'correct horse battery staple' });

      await authenticated();
      expect(mounted.requests).toHaveLength(1);
    });

    it('rejects an address that does not parse, with the shared schema as the judge', async () => {
      await typeInto('signup-email', 'ada@');
      await typeInto('signup-password', VALID.password);
      await pressOn('signup-submit');

      expect(screen.getByText(VALIDATION_COPY.email.invalid)).toBeTruthy();
      expect(mounted.requests).toHaveLength(0);
    });

    it('stays silent while a field is being typed into for the first time', async () => {
      // §1.2 rule 2 — the rule that stops the form answering the letter `a` with
      // "Enter a valid email address."
      await typeInto('signup-email', 'a');
      await typeInto('signup-password', 'a');

      expect(screen.queryByText(VALIDATION_COPY.email.invalid)).toBeNull();
      expect(screen.queryByText(VALIDATION_COPY.password.short)).toBeNull();
    });

    it('shows a field error on blur, once the user has left the field', async () => {
      await typeInto('signup-email', 'nope');
      expect(screen.queryByText(VALIDATION_COPY.email.invalid)).toBeNull();

      await blur('signup-email');

      // Blur is the first moment the user has finished composing a value, so it is the
      // first moment an error is fair (§1.2 rule 2).
      expect(screen.getByText(VALIDATION_COPY.email.invalid)).toBeTruthy();
    });

    it('does not make a field live when it blurs with nothing wrong', async () => {
      await typeInto('signup-email', VALID.email);
      await blur('signup-email');

      // Nothing was shown, so there is nothing for the user to watch clear as they type —
      // and a field that went live silently would start erroring mid-edit on the next
      // change. Pinned here because it is invisible in a screenshot.
      expect(screen.queryByText(VALIDATION_COPY.email.invalid)).toBeNull();

      await typeInto('signup-email', 'ada@');

      expect(screen.queryByText(VALIDATION_COPY.email.invalid)).toBeNull();
    });
  });

  describe('the currency select', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => ok(201, authResponse()),
      });
    });

    it('starts on the default the contract would have applied anyway', async () => {
      // §1.2 element 11: prefilled `USD - US Dollar`.
      expect(screen.getByText('USD - US Dollar')).toBeTruthy();
    });

    it('names itself for a screen reader without reading the hyphen aloud', async () => {
      // §1.2 element 11. `USD - US Dollar` is read as "USD minus US Dollar", which is not
      // what the row says.
      expect(screen.getByTestId('signup-currency').props.accessibilityLabel).toBe(
        'Currency, USD US Dollar. Double tap to change.',
      );
    });

    it('says the choice is permanent, where the choice is made', async () => {
      // §1.2 element 12, under the select rather than discovered later in Settings.
      expect(screen.getByText('You cannot change this later.')).toBeTruthy();
    });

    it('sends the currency the user picked', async () => {
      await pressOn('signup-currency');
      await pressOn('currency-JPY');

      expect(screen.getByText('JPY - Japanese Yen')).toBeTruthy();

      await submitForm();
      await authenticated();

      // The field the whole account's money formatting hangs off. `JPY` has no minor
      // unit, so this value also decides that the amount keypad has no decimal key
      // (§1.2 rule 9).
      expect(mounted.requests[0]?.body).toEqual({
        email: VALID.email,
        password: VALID.password,
        currency: 'JPY',
      });
    });

    it('sends the default when the user never opens the sheet', async () => {
      await submitForm();
      await authenticated();

      expect(mounted.requests[0]?.body).toEqual({ ...VALID, currency: 'USD' });
    });

    it('keeps the typed credentials when the sheet opens and closes', async () => {
      await typeInto('signup-email', VALID.email);
      await typeInto('signup-password', VALID.password);

      await pressOn('signup-currency');
      await pressOn('currency-EUR');

      expect(screen.getByTestId('signup-email').props.value).toBe(VALID.email);
      expect(screen.getByTestId('signup-password').props.value).toBe(VALID.password);
    });
  });

  describe('a successful signup', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => ok(201, authResponse({ currency: 'JPY' })),
      });
    });

    it('persists the session and the profile in one go', async () => {
      await submitForm();
      await authenticated();

      // §1.2 rule 7: the token pair to secure store and the `user` row to SQLite.
      const persisted = [...secureStore().values()].join(' ');
      expect(persisted).toContain('access-1');
      expect(persisted).toContain('refresh-1');

      // The currency written is the one the *server* confirmed, not the one the form
      // happened to be showing. They agree here, but the server is the authority on what
      // the account was actually created with.
      expect(await readUser(mounted.database)).toMatchObject({ currency: 'JPY' });
    });

    it('claims the local database for the new account', async () => {
      await submitForm();
      await authenticated();

      const rows = await mounted.database.getAllAsync<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?',
        [OWNER_KEY],
      );
      expect(rows[0]?.value).toBe('0192f5a0-0000-7000-8000-00000000a001');
    });

    it('does not seed the default categories locally', async () => {
      await submitForm();
      await authenticated();

      // §1.2 rule 7: the server already created them at signup, so seeding locally and
      // pushing would produce a duplicate set. The background pull brings the server's.
      const rows = await mounted.database.getAllAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM categories',
        [],
      );
      expect(rows[0]?.n).toBe(0);
    });

    it('shows no success toast, because arriving at Home is the confirmation', async () => {
      await submitForm();
      await authenticated();

      // §1.2 rule 7, and navigation is the route guard's job, not this screen's.
      expect(routerRecord.push).toHaveLength(0);
      expect(routerRecord.replace).toHaveLength(0);
    });
  });

  describe('when the email is already registered', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => apiError(409, 'email_already_exists'),
      });
      await submitForm();
      await screen.findByText('That email is already registered.');
    });

    it('puts the error on the Email field, not in a banner', async () => {
      // §1.2 rule 4. The user can act on this one by changing the address, so it belongs
      // beside the address.
      expect(screen.queryByTestId('signup-banner')).toBeNull();
      expect(screen.getByTestId('signup-email').props.accessibilityLabel).toBe(
        'Email, invalid: That email is already registered.',
      );
    });

    it('offers to log in instead, carrying the address already typed', async () => {
      await pressOn('signup-login-instead');

      // §1.2 rule 4: prefilled, so only the password is still needed. `replace`, not
      // `push` — the user is switching doors, not stacking a second one behind them.
      expect(routerRecord.replace).toEqual([
        { pathname: '/(auth)/login', params: { email: VALID.email } },
      ]);
    });

    it('withdraws the offer once a different address is typed', async () => {
      await typeInto('signup-email', 'fresh@example.com');

      // The link was tied to the error that justified it. With that error gone it has
      // nothing left to refer to, and offering to log in to an account that was never
      // claimed to exist would be a guess.
      expect(screen.queryByTestId('signup-login-instead')).toBeNull();
    });

    it('keeps the password, so only the address has to be changed', async () => {
      expect(screen.getByTestId('signup-password').props.value).toBe(VALID.password);
    });
  });

  describe('when the server rejects the body', () => {
    it('renders the server message in the matching field slot', async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () =>
          apiError(400, 'validation_error', {
            details: { issues: [{ path: 'body.password', message: 'Password is too common.' }] },
          }),
      });

      await submitForm();

      // §1.2 rule 5: map `issues[].path` onto the field and render `issues[].message`.
      expect(await screen.findByText('Password is too common.')).toBeTruthy();
      expect(screen.queryByTestId('signup-banner')).toBeNull();
    });

    it('falls back to the banner for a path with no field on screen, and hides the path', async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () =>
          apiError(400, 'validation_error', {
            details: { issues: [{ path: 'body.currency', message: 'Unsupported currency.' }] },
          }),
      });

      await submitForm();

      // §1.2 rule 5: "The UI never shows a raw `path` string." A validation failure on
      // the currency is a client bug — it comes from a fixed list of ten codes — and
      // there is no error slot under the select for it.
      expect(await screen.findByText('Something went wrong on our end. Try again.')).toBeTruthy();
      expect(screen.queryByText(/body\.currency/)).toBeNull();
    });
  });

  describe('other failures', () => {
    it('tells an offline user what is blocked, in signup’s own words', async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => {
          throw new NetworkUnavailableError(new TypeError('Network request failed'));
        },
      });

      await submitForm();

      // §1.2 offline-pending. The two offline strings differ on purpose: this one names
      // creating an account, login's names logging in.
      expect(await screen.findByText(OFFLINE_COPY.signup)).toBeTruthy();
      expect(screen.queryByText(OFFLINE_COPY.login)).toBeNull();
      // Fields keep their values and submit returns to enabled.
      expect(screen.getByTestId('signup-password').props.value).toBe(VALID.password);
      expect(screen.getByTestId('signup-submit').props.accessibilityState.busy).toBe(false);
    });

    it('renders rate limiting as a form-level banner', async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => apiError(429, 'rate_limited'),
      });

      await submitForm();

      // §1.2 rule 6.
      expect(await screen.findByText('Too many attempts. Try again in a moment.')).toBeTruthy();
      expect(screen.getByTestId('signup-submit').props.accessibilityState.busy).toBe(false);
    });

    it('never leaves a half-made session behind', async () => {
      mounted = await mountScreen(<SignupScreen />, {
        transport: async () => apiError(500, 'internal_error'),
      });

      await submitForm();
      await screen.findByText('Something went wrong on our end. Try again.');

      expect(mounted.container.session.getSnapshot().status).toBe('anonymous');
      expect([...secureStore().keys()]).toHaveLength(0);
    });
  });

  describe('going back', () => {
    it('returns to Welcome, discarding input without a prompt', async () => {
      mounted = await mountScreen(<SignupScreen />, { transport: noNetwork });

      await typeInto('signup-email', VALID.email);
      await pressOn('signup-back');

      // §1.2 rule 11: nothing of value has been created yet, so there is nothing to warn
      // about losing.
      expect(routerRecord.back).toBe(1);
    });
  });
});
