import { screen } from '@testing-library/react-native';
import { COPY, OFFLINE_COPY, SESSION_EXPIRED } from '@/copy/strings';
import WelcomeScreen from '../../app/(auth)/welcome';
import { resetRouter, routerRecord } from '../support/router';
import { mountWithSession, pressOn } from '../support/mount';

jest.mock('expo-router');

/**
 * Welcome — `docs/design/03-auth.md` §1.1.
 *
 * "Give a first-time user the two doors in and nothing else", which makes most of this
 * file about what the screen must *not* say. Two absences are specified rather than
 * accidental, and both are the kind of thing a well-meaning change would add back:
 *
 * - **No offline banner, ever** (§1.1 `offline-pending`). A user with no account has
 *   nothing to sync, and warning them about connectivity before they have tried anything
 *   is noise. Offline is surfaced on the attempt, where it is actionable.
 * - **No expired notice on a cold start with no token** (§1.1 rule 4). That user was not
 *   kicked out, they simply are not logged in, and telling them their session expired is
 *   a lie about something that never happened.
 */

const ANONYMOUS = { status: 'anonymous', expired: false } as const;
const EXPIRED = { status: 'anonymous', expired: true } as const;

describe('the welcome screen', () => {
  beforeEach(() => {
    resetRouter();
  });

  describe('the two doors', () => {
    beforeEach(async () => {
      await mountWithSession(<WelcomeScreen />, ANONYMOUS);
    });

    it('offers exactly the two CTAs, by their specified copy', async () => {
      // Queried by accessible name rather than by text: `Button` hides its own label from
      // accessibility so the name is not read twice, and the name is what a screen reader
      // user actually gets (§1.1 elements 4 and 5).
      expect(screen.getByLabelText(COPY.welcome.cta.signup)).toBeTruthy();
      expect(screen.getByLabelText(COPY.welcome.cta.login)).toBeTruthy();
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('names the app and says what it is for', async () => {
      expect(screen.getByText(COPY.app.name)).toBeTruthy();
      expect(screen.getByText(COPY.welcome.tagline)).toBeTruthy();
    });

    it('sends Create account to signup', async () => {
      await pressOn('welcome-signup');

      expect(routerRecord.push).toEqual(['/(auth)/signup']);
    });

    it('sends the returning user to login', async () => {
      await pressOn('welcome-login');

      expect(routerRecord.push).toEqual(['/(auth)/login']);
    });

    it('warns about connectivity nowhere, banner or pill', async () => {
      // §1.1 `offline-pending`: identical to default. The tagline mentions being offline
      // as a *feature* ("online or not"), which is the opposite of a warning — so what
      // must be absent is the two blocking messages and the sync pill, not the word.
      expect(screen.queryByText(OFFLINE_COPY.signup)).toBeNull();
      expect(screen.queryByText(OFFLINE_COPY.login)).toBeNull();
      expect(screen.queryByText(/no connection|you are offline/i)).toBeNull();
    });
  });

  describe('the session-expired notice', () => {
    it('stays away on a cold start that simply has no token', async () => {
      // §1.1 rule 4 — the distinction the `expired` flag exists to carry.
      await mountWithSession(<WelcomeScreen />, ANONYMOUS);

      expect(screen.queryByTestId('session-expired')).toBeNull();
      expect(screen.queryByText(SESSION_EXPIRED)).toBeNull();
    });

    it('appears when a refresh was actually rejected', async () => {
      await mountWithSession(<WelcomeScreen />, EXPIRED);

      expect(screen.getByTestId('session-expired')).toBeTruthy();
      expect(screen.getByText(SESSION_EXPIRED)).toBeTruthy();
    });

    it('is dismissed by tapping either door', async () => {
      await mountWithSession(<WelcomeScreen />, EXPIRED);
      expect(screen.getByText(SESSION_EXPIRED)).toBeTruthy();

      await pressOn('welcome-login');

      // §1.1: "Dismissed when the user taps either CTA." The user is acting on the
      // notice, so it has done its job.
      expect(screen.queryByText(SESSION_EXPIRED)).toBeNull();
      expect(routerRecord.push).toEqual(['/(auth)/login']);
    });
  });
});
