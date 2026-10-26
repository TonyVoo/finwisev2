import { screen, waitFor } from '@testing-library/react-native';
import { NetworkUnavailableError } from '@/api/errors';
import { OFFLINE_COPY, VALIDATION_COPY } from '@/copy/strings';
import { OWNER_KEY } from '@/db/localStore';
import { readUser } from '@/db/user';
import LoginScreen from '../../app/(auth)/login';
import { resetRouter, routerRecord, setSearchParams } from '../support/router';
import {
  apiError,
  authResponse,
  mountScreen,
  ok,
  pressOn,
  secureStore,
  typeInto,
  type MountedScreen,
} from '../support/mount';

jest.mock('expo-router');

/**
 * Log in, through the screen — `docs/design/03-auth.md` §1.3.
 *
 * `session.test.ts` proves the controller stores a pair and `authErrors.test.ts` proves a
 * code maps to a string. Neither proves the *screen* is wired to either, and that gap is
 * exactly where TVO-10's acceptance criteria live: "successful login stores the session"
 * and "failed login surfaces the error" are claims about what happens when a user types
 * into a field and taps a button.
 *
 * So these cases drive the real UI over a fake network and assert on the real secure
 * store. The one distinction worth the whole file is §1.3: **a wrong password and no
 * network must not look the same.** Both are a failed login that leaves the user on this
 * screen, and the lazy implementation of both is one `catch` and one string.
 */

const CREDENTIALS = { email: 'ada@example.com', password: 'correct-horse' };

/**
 * Auth requests only. A successful sign-in now starts a sync (`TVO-34`), so the pull that
 * follows is expected traffic; what these cases pin is that the *form* sent one request.
 */
const authRequests = (requests: readonly { readonly path: string }[]) =>
  requests.filter((request) => request.path.startsWith('/v1/auth/'));

describe('the log in screen', () => {
  let mounted: MountedScreen;

  beforeEach(() => {
    resetRouter();
    secureStore().clear();
  });

  afterEach(() => {
    mounted?.database.close();
  });

  /** Fill both fields and tap Log in. */
  async function submitCredentials({ email, password } = CREDENTIALS): Promise<void> {
    await typeInto('login-email', email);
    await typeInto('login-password', password);
    await pressOn('login-submit');
  }

  const authenticated = () =>
    waitFor(() => {
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
    });

  describe('validation', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => {
          throw new Error('validation must fail before anything is sent');
        },
      });
    });

    it('reveals both errors when submitted empty, rather than disabling the button', async () => {
      // §1.2 rule 1: the button is never disabled, because a dead control gives the user
      // no way to find out what is wrong. Tapping it is how they find out.
      await pressOn('login-submit');

      expect(screen.getByText(VALIDATION_COPY.email.empty)).toBeTruthy();
      expect(screen.getByText(VALIDATION_COPY.password.empty)).toBeTruthy();
      // Nothing was sent: the transport above would have thrown.
      expect(mounted.requests).toHaveLength(0);
    });

    it('does not show an error while the user is still typing a value for the first time', async () => {
      // §1.2 rule 2. The field has never shown an error, so it is not live yet and a
      // keystroke must not make it one — otherwise the first character typed into Email
      // is answered with "Enter your email address."
      await typeInto('login-email', 'a');

      expect(screen.queryByText(VALIDATION_COPY.email.empty)).toBeNull();
    });

    it('clears a shown error as the user fixes it', async () => {
      await pressOn('login-submit');
      expect(screen.getByText(VALIDATION_COPY.email.empty)).toBeTruthy();

      // Now that it has been shown, the field is live and re-validates per keystroke.
      await typeInto('login-email', 'ada@example.com');

      expect(screen.queryByText(VALIDATION_COPY.email.empty)).toBeNull();
    });

    it('puts the error into the accessible name of the field, not only beneath it', async () => {
      // `00-foundations.md` §6: a screen-reader user who lands on the input must hear why
      // it is wrong without going hunting for the helper slot below it.
      await pressOn('login-submit');

      expect(screen.getByTestId('login-email').props.accessibilityLabel).toBe(
        `Email, invalid: ${VALIDATION_COPY.email.empty}`,
      );
    });
  });

  describe('a successful login', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => ok(200, authResponse()),
      });
    });

    it('stores the session where a cold start will find it', async () => {
      await submitCredentials();

      // The acceptance criterion, asserted against the store the app really reads at
      // launch rather than against a spy: the tokens are in `expo-secure-store`.
      await authenticated();
      expect(await mounted.container.session.getAccessToken()).toBe('access-1');

      const persisted = [...secureStore().values()].join(' ');
      expect(persisted).toContain('access-1');
      expect(persisted).toContain('refresh-1');
    });

    it('stamps the local database with the user who signed in', async () => {
      await submitCredentials();
      await authenticated();

      // The other half of a session: `localStore.adopt` claims the database for this
      // user, which is what stops the next account reading these rows (`TVO-16`).
      const rows = await mounted.database.getAllAsync<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?',
        [OWNER_KEY],
      );
      expect(rows[0]?.value).toBe('0192f5a0-0000-7000-8000-00000000a001');
    });

    it('writes the profile row the first screen behind the gate formats money with', async () => {
      await submitCredentials();
      await authenticated();

      // §1.3 rule 4. The currency comes from this row rather than from a request, so a
      // cold start with no network still renders amounts correctly. A store that was
      // adopted but had no profile yet would render that first frame with no currency.
      const user = await readUser(mounted.database);
      expect(user).toMatchObject({ email: 'ada@example.com', currency: 'USD' });
    });

    it('sends the trimmed address, so a keyboard autocomplete does not cause a 400', async () => {
      await submitCredentials({ email: '  ada@example.com  ', password: 'correct-horse' });

      await authenticated();
      expect(mounted.requests[0]?.body).toEqual({
        email: 'ada@example.com',
        password: 'correct-horse',
      });
    });

    it('leaves navigation to the route guard', async () => {
      await submitCredentials();
      await authenticated();

      // §1.3 rule 4 is served by the `(auth)` layout redirecting on `authenticated`, not
      // by this screen pushing a route. If both did it, two places would decide where a
      // signed-in user lands and they would eventually disagree.
      expect(routerRecord.replace).toHaveLength(0);
      expect(routerRecord.push).toHaveLength(0);
    });

    it('keeps the submit button busy through the handover', async () => {
      await submitCredentials();
      await authenticated();

      // §1.3 States: the Busy state persists through the replace, and Home then owns the
      // hydrating state. Clearing it would flash an idle button on a screen that is being
      // replaced.
      expect(screen.getByTestId('login-submit').props.accessibilityState.busy).toBe(true);
    });

    it('ignores a second submit while the first is in flight', async () => {
      await submitCredentials();
      await authenticated();

      await pressOn('login-submit');

      // One account, one request. The button ignores taps while busy, and `useAuthForm`
      // guards the hardware keyboard's Go key, which does not go through the button.
      expect(authRequests(mounted.requests)).toHaveLength(1);
    });
  });

  describe('presence-only validation', () => {
    it('sends an address it has no opinion on', async () => {
      // §1.3 rule 1. `not-an-email` is not a valid address, and this screen still sends
      // it: rejecting a credential the server might accept locks a user out of their own
      // account, and a login form has no business telling anyone what a password should
      // look like.
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => ok(200, authResponse()),
      });

      await submitCredentials({ email: 'not-an-email', password: 'short' });

      expect(screen.queryByText(VALIDATION_COPY.email.invalid)).toBeNull();
      expect(screen.queryByText(VALIDATION_COPY.password.short)).toBeNull();
      expect(authRequests(mounted.requests)).toHaveLength(1);
    });
  });

  describe('a failed login', () => {
    it('surfaces invalid credentials as a form-level banner, not a field error', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(401, 'invalid_credentials'),
      });

      await submitCredentials();

      // §1.3 rule 2: form-level, and the copy never says which half was wrong. A
      // field-level error on Email would confirm whether an account exists.
      expect(await screen.findByTestId('login-banner')).toBeTruthy();
      expect(screen.getByText('That email or password is incorrect.')).toBeTruthy();

      // Neither field enters its error state, so neither accessible name says "invalid".
      expect(screen.getByTestId('login-email').props.accessibilityLabel).toBe('Email');
      expect(screen.getByTestId('login-password').props.accessibilityLabel).toBe('Password');
      expect(mounted.container.session.getSnapshot().status).toBe('anonymous');
    });

    it('stores nothing, so a restart does not resurrect a rejected attempt', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(401, 'invalid_credentials'),
      });

      await submitCredentials();
      await screen.findByTestId('login-banner');

      expect([...secureStore().keys()]).toHaveLength(0);
    });

    it('does not clear the password', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(401, 'invalid_credentials'),
      });

      await submitCredentials();
      await screen.findByTestId('login-banner');

      // §1.2 rule 10. Clearing it on a failed attempt is a punishment for a typo in a
      // different field — and on this screen the typo is usually in the password, so
      // retyping the whole thing is the one thing the user least wants to do.
      expect(screen.getByTestId('login-password').props.value).toBe('correct-horse');
      expect(screen.getByTestId('login-email').props.value).toBe('ada@example.com');
    });

    it('returns the button to enabled so the attempt can be retried', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(401, 'invalid_credentials'),
      });

      await submitCredentials();
      await screen.findByTestId('login-banner');

      expect(screen.getByTestId('login-submit').props.accessibilityState.busy).toBe(false);
    });

    it('tells an offline user what is blocked, in words a wrong password never produces', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => {
          throw new NetworkUnavailableError(new TypeError('Network request failed'));
        },
      });

      await submitCredentials();

      // The criterion in TVO-10's own words: "'Wrong password' and 'no network' must not
      // look the same to the user." Login is the one place where offline legitimately
      // blocks, and the copy says which action is blocked rather than announcing that the
      // network is down.
      expect(await screen.findByText(OFFLINE_COPY.login)).toBeTruthy();
      expect(screen.queryByText('That email or password is incorrect.')).toBeNull();
      // Fields keep their values; submit returns to enabled (§1.3 offline-pending).
      expect(screen.getByTestId('login-password').props.value).toBe('correct-horse');
      expect(screen.getByTestId('login-submit').props.accessibilityState.busy).toBe(false);
    });

    it('renders rate limiting without inventing a countdown', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(429, 'rate_limited'),
      });

      await submitCredentials();

      // §1.2 rule 6: deliberately vague rather than a timer the user must watch.
      expect(await screen.findByText('Too many attempts. Try again in a moment.')).toBeTruthy();
    });

    it('falls back to the generic banner on a 500, and never shows a raw code', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(500, 'internal_error'),
      });

      await submitCredentials();

      // §1.3 rule 6.
      expect(await screen.findByText('Something went wrong on our end. Try again.')).toBeTruthy();
      expect(screen.queryByText(/internal_error/)).toBeNull();
    });

    it('renders the generic banner for a code it has never heard of', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(418, 'some_future_code'),
      });

      await submitCredentials();

      // `09-copy-deck.md` rule 4: an unrecognised code from a newer server renders the
      // generic copy, never the raw code.
      expect(await screen.findByText('Something went wrong on our end. Try again.')).toBeTruthy();
      expect(screen.queryByText(/some_future_code/)).toBeNull();
    });

    it('replaces a stale banner on the next attempt rather than stacking', async () => {
      let code = 'invalid_credentials';
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(code === 'invalid_credentials' ? 401 : 429, code),
      });

      await submitCredentials();
      await screen.findByText('That email or password is incorrect.');

      code = 'rate_limited';
      await submitCredentials();

      await screen.findByText('Too many attempts. Try again in a moment.');
      expect(screen.queryByText('That email or password is incorrect.')).toBeNull();
    });

    it('keeps the banner while the user retypes, since the attempt really happened', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => apiError(401, 'invalid_credentials'),
      });

      await submitCredentials();
      await screen.findByTestId('login-banner');

      await typeInto('login-password', 'another-guess');

      // Clearing it as they retype would erase the only record of why the last attempt
      // failed, before they have made another one (`src/auth/formState.ts`).
      expect(screen.getByText('That email or password is incorrect.')).toBeTruthy();
    });
  });

  describe('arriving from the signup screen', () => {
    it('prefills the email that was already typed', async () => {
      // §1.2 rule 4 / §1.3 States: the `Log in instead` link carries the address, so only
      // the password is still needed.
      setSearchParams({ email: 'taken@example.com' });
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => ok(200, authResponse()),
      });

      expect(screen.getByTestId('login-email').props.value).toBe('taken@example.com');
    });
  });

  describe('going back', () => {
    it('returns to Welcome', async () => {
      mounted = await mountScreen(<LoginScreen />, {
        transport: async () => ok(200, authResponse()),
      });

      await pressOn('login-back');

      // §1.3 rule 7. Welcome is the root of the stack, so a plain `back` is enough.
      expect(routerRecord.back).toBe(1);
    });
  });
});
