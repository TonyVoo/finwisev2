import { screen } from '@testing-library/react-native';
import AppLayout from '../../app/(app)/_layout';
import AuthLayout from '../../app/(auth)/_layout';
import { resetRouter, routerRecord } from '../support/router';
import { mountWithSession } from '../support/mount';

jest.mock('expo-router');

/**
 * The auth gate, both ways — TVO-10's "auth-gated routes redirect to login when there is
 * no valid session".
 *
 * There are two guards and they point in opposite directions, which is the part worth
 * pinning. `(app)` keeps a user with no session out of the data; `(auth)` keeps a user who
 * already has one out of the login form, so a deep link or a stale back stack cannot
 * present a signed-in user with a form for a session they are already holding.
 *
 * Both are rendered as a `<Redirect>` rather than a `router.replace` in an effect, and the
 * difference is a frame of someone else's expenses: an effect runs after the first paint.
 * That is why these cases assert on what was *rendered* instead of on a navigation call.
 */

const LOADING = { status: 'loading', expired: false } as const;
const ANONYMOUS = { status: 'anonymous', expired: false } as const;
const EXPIRED = { status: 'anonymous', expired: true } as const;
const AUTHENTICATED = { status: 'authenticated', expired: false } as const;

describe('the route guards', () => {
  beforeEach(() => {
    resetRouter();
  });

  describe('the (app) group, which holds the user data', () => {
    it('sends an anonymous visitor to Welcome', async () => {
      await mountWithSession(<AppLayout />, ANONYMOUS);

      expect(routerRecord.redirects).toEqual(['/(auth)/welcome']);
    });

    it('sends a visitor whose session just expired to Welcome, where the notice is', async () => {
      await mountWithSession(<AppLayout />, EXPIRED);

      expect(routerRecord.redirects).toEqual(['/(auth)/welcome']);
    });

    it('renders nothing of the app while it redirects', async () => {
      await mountWithSession(<AppLayout />, ANONYMOUS);

      // The whole point of redirecting in render: there is no first frame of Home for an
      // unauthenticated user to see.
      expect(screen.toJSON()?.children ?? []).toHaveLength(0);
    });

    it('redirects rather than opening the gate while the session is still unknown', async () => {
      // The root layout holds the splash screen until secure store has been read, so this
      // state should never reach here. If it ever does, the safe answer is the one that
      // does not show the data.
      await mountWithSession(<AppLayout />, LOADING);

      expect(routerRecord.redirects).toEqual(['/(auth)/welcome']);
    });

    it('lets an authenticated user through', async () => {
      await mountWithSession(<AppLayout />, AUTHENTICATED);

      expect(routerRecord.redirects).toHaveLength(0);
    });
  });

  describe('the (auth) group, which holds the forms', () => {
    it('lets an anonymous visitor reach the forms', async () => {
      await mountWithSession(<AuthLayout />, ANONYMOUS);

      expect(routerRecord.redirects).toHaveLength(0);
    });

    it('sends an already signed-in user to the app', async () => {
      // This is also what completes a login: `useAuthForm` adopts the session and stops,
      // and this redirect is what moves the user. One place decides where a signed-in
      // user lands.
      await mountWithSession(<AuthLayout />, AUTHENTICATED);

      expect(routerRecord.redirects).toEqual(['/(app)/(tabs)']);
    });
  });
});
