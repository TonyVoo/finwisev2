import { screen, waitFor } from '@testing-library/react-native';
import { NetworkUnavailableError } from '@/api/errors';
import type { Transport, TransportRequest } from '@/api/transport';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import ForgotPasswordScreen from '../../app/(auth)/forgot-password';
import LoginScreen from '../../app/(auth)/login';
import ResetPasswordScreen from '../../app/(auth)/reset-password';
import { resetRouter, routerRecord, setSearchParams } from '../support/router';
import {
  apiError,
  mountScreen,
  ok,
  pressOn,
  secureStore,
  typeInto,
  type MountedScreen,
} from '../support/mount';

const GENERIC_ERROR = COPY.error.generic;

jest.mock('expo-router');

/**
 * Forgot password, through its screens (`docs/design/03-auth.md` §4).
 *
 * The cases pin what is easy to get subtly wrong: that the request screen moves on whatever
 * the server says (it must not be able to leak whether an account exists), that a wrong code
 * is a field error and not a banner, and that success returns to Log in rather than signing
 * the user in - the reset ended every session, this device's included.
 */

describe('password reset screens', () => {
  let mounted: MountedScreen;
  let requests: TransportRequest[];
  let handler: (request: TransportRequest) => ReturnType<Transport>;

  const transport: Transport = async (request) => {
    requests.push(request);
    return handler(request);
  };

  beforeEach(() => {
    resetRouter();
    secureStore().clear();
    requests = [];
    handler = async () => ok(204, undefined);
  });

  afterEach(() => {
    mounted?.database.close();
  });

  describe('the link on Log in', () => {
    it('opens the request screen', async () => {
      mounted = await mountScreen(<LoginScreen />, { transport });
      await pressOn('login-forgot');
      expect(routerRecord.push).toEqual(['/(auth)/forgot-password']);
    });
  });

  describe('asking for a code', () => {
    beforeEach(async () => {
      mounted = await mountScreen(<ForgotPasswordScreen />, { transport });
    });

    it('validates the email locally and sends nothing', async () => {
      await typeInto('forgot-password-email', 'not-an-email');
      await pressOn('forgot-password-submit');

      expect(screen.getByText(VALIDATION_COPY.email.invalid)).toBeTruthy();
      expect(requests).toEqual([]);
      expect(routerRecord.push).toEqual([]);
    });

    it('sends the normalised email and moves on to the code screen', async () => {
      await typeInto('forgot-password-email', '  Ada@Example.com ');
      await pressOn('forgot-password-submit');

      await waitFor(() => expect(routerRecord.push).toHaveLength(1));
      expect(requests[0]).toMatchObject({
        method: 'post',
        path: '/v1/auth/forgot-password',
        body: { email: 'ada@example.com' },
      });
      expect(routerRecord.push[0]).toEqual({
        pathname: '/(auth)/reset-password',
        params: { email: 'ada@example.com' },
      });
    });

    it('names the blocked action when offline, and stays put', async () => {
      handler = async () => {
        throw new NetworkUnavailableError(new Error('down'));
      };
      await typeInto('forgot-password-email', 'ada@example.com');
      await pressOn('forgot-password-submit');

      expect(await screen.findByText(COPY.forgotPassword.offline)).toBeTruthy();
      expect(routerRecord.push).toEqual([]);
    });

    it('shows the throttle as a banner', async () => {
      handler = async () => apiError(429, 'rate_limited');
      await typeInto('forgot-password-email', 'ada@example.com');
      await pressOn('forgot-password-submit');

      expect(await screen.findByText(COPY.account.tooManyAttempts)).toBeTruthy();
    });

    it('falls back to the generic banner for anything else', async () => {
      handler = async () => apiError(500, 'internal_error');
      await typeInto('forgot-password-email', 'ada@example.com');
      await pressOn('forgot-password-submit');

      expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    });
  });

  describe('entering the code', () => {
    beforeEach(async () => {
      setSearchParams({ email: 'ada@example.com' });
      mounted = await mountScreen(<ResetPasswordScreen />, { transport });
    });

    it('names the address the code went to, as a maybe', () => {
      expect(
        screen.getByText(COPY.resetPassword.hint.replace('{email}', 'ada@example.com')),
      ).toBeTruthy();
    });

    it('accepts only digits, and at most six', async () => {
      await typeInto('reset-password-code', '12a3-456789');
      expect(screen.getByTestId('reset-password-code').props.value).toBe('123456');
    });

    it('validates locally - a short code and a short password - and sends nothing', async () => {
      await typeInto('reset-password-code', '123');
      await typeInto('reset-password-new', 'short');
      await pressOn('reset-password-submit');

      expect(screen.getByText(COPY.resetPassword.invalidCode)).toBeTruthy();
      expect(screen.getByText(VALIDATION_COPY.password.short)).toBeTruthy();
      expect(requests).toEqual([]);
    });

    it('sends the code and password, then returns to Log in with the email - not signed in', async () => {
      await typeInto('reset-password-code', '482916');
      await typeInto('reset-password-new', 'brand-new-password');
      await pressOn('reset-password-submit');

      await waitFor(() => expect(routerRecord.replace).toHaveLength(1));
      expect(requests[0]).toMatchObject({
        method: 'post',
        path: '/v1/auth/reset-password',
        body: { email: 'ada@example.com', code: '482916', newPassword: 'brand-new-password' },
      });
      expect(routerRecord.replace[0]).toEqual({
        pathname: '/(auth)/login',
        params: { email: 'ada@example.com' },
      });
      expect(mounted.container.session.getSnapshot().status).not.toBe('authenticated');
    });

    it('puts a bad code on the Code field, not in a banner', async () => {
      handler = async () => apiError(400, 'invalid_reset_code');
      await typeInto('reset-password-code', '482916');
      await typeInto('reset-password-new', 'brand-new-password');
      await pressOn('reset-password-submit');

      expect(await screen.findByText(COPY.resetPassword.invalidCode)).toBeTruthy();
      expect(screen.queryByTestId('reset-password-banner')).toBeNull();
      expect(routerRecord.replace).toEqual([]);
    });

    it('names the blocked action when offline', async () => {
      handler = async () => {
        throw new NetworkUnavailableError(new Error('down'));
      };
      await typeInto('reset-password-code', '482916');
      await typeInto('reset-password-new', 'brand-new-password');
      await pressOn('reset-password-submit');

      expect(await screen.findByText(COPY.resetPassword.offline)).toBeTruthy();
    });

    it('asks for a new code from the same address', async () => {
      await pressOn('reset-password-resend');

      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toMatchObject({
        path: '/v1/auth/forgot-password',
        body: { email: 'ada@example.com' },
      });
    });
  });
});
