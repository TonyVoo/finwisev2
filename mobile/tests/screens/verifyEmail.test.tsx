import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { NetworkUnavailableError } from '@/api/errors';
import type { Transport, TransportRequest } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { readEmailVerified } from '@/db/user';
import { queryKeys } from '@/query/keys';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
import VerifyEmailScreen from '../../app/(app)/settings/verify-email';
import { resetRouter, routerRecord } from '../support/router';
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

const GENERIC_ERROR = COPY.error.generic;

jest.mock('expo-router');

/**
 * Email verification, through Settings and its code screen.
 *
 * What these pin: the Settings row exists only while the address is unverified, a wrong code
 * is a field error (not a banner), success rewrites the local user row so the row goes away,
 * and a typo never costs one of the server's five attempts.
 */

describe('verify email', () => {
  let mounted: MountedScreen;
  let requests: TransportRequest[];
  let handler: (request: TransportRequest) => ReturnType<Transport>;

  const transport: Transport = async (request) => {
    requests.push(request);
    return handler(request);
  };

  const emptyPage = { items: [], nextCursor: null, hasMore: false };

  beforeEach(() => {
    resetRouter();
    secureStore().clear();
    requests = [];
    handler = async () => ok(200, emptyPage);
  });

  afterEach(async () => {
    await cleanup();
    mounted?.database.close();
  });

  async function signedIn(screenElement: React.ReactElement): Promise<void> {
    mounted = await mountScreen(screenElement, { transport });
    await mounted.container.session.signIn(authResponse());
    await mounted.container.sync.sync('manual');
    await act(async () => {
      await mounted.container.queryClient.invalidateQueries({ queryKey: queryKeys.local() });
    });
    requests.length = 0;
  }

  describe('the Settings row', () => {
    it('is offered while the email is unverified, and opens the code screen', async () => {
      await signedIn(<SettingsScreen />);

      fireEvent.press(await screen.findByTestId('settings-verify-email'));

      expect(screen.getByText(COPY.settings.unverified)).toBeTruthy();
      expect(routerRecord.push).toEqual(['/(app)/settings/verify-email']);
    });

    it('is absent once verified', async () => {
      mounted = await mountScreen(<SettingsScreen />, { transport });
      const response = authResponse();
      await mounted.container.session.signIn({
        ...response,
        user: { ...response.user, emailVerified: true },
      });
      await mounted.container.sync.sync('manual');
      await act(async () => {
        await mounted.container.queryClient.invalidateQueries({ queryKey: queryKeys.local() });
      });

      await screen.findByTestId('settings-email');
      expect(screen.queryByTestId('settings-verify-email')).toBeNull();
    });
  });

  describe('the code screen', () => {
    beforeEach(async () => {
      await signedIn(<VerifyEmailScreen />);
    });

    it('names the address the code went to', async () => {
      expect(
        await screen.findByText(COPY.verifyEmail.hint.replace('{email}', 'ada@example.com')),
      ).toBeTruthy();
    });

    it('accepts only digits, at most six, and sends nothing for a short code', async () => {
      await typeInto('verify-email-code', '12a3-456789');
      expect(screen.getByTestId('verify-email-code').props.value).toBe('123456');

      await typeInto('verify-email-code', '123');
      await pressOn('verify-email-submit');
      expect(screen.getByText(COPY.verifyEmail.invalidCode)).toBeTruthy();
      expect(requests).toEqual([]);
    });

    it('confirms the code, stores the verified user and goes back', async () => {
      handler = async () => {
        const response = authResponse();
        return ok(200, { user: { ...response.user, emailVerified: true } });
      };
      await typeInto('verify-email-code', '482916');
      await pressOn('verify-email-submit');

      await waitFor(() => expect(routerRecord.back).toBe(1));
      expect(requests[0]).toMatchObject({
        method: 'post',
        path: '/v1/me/email-verification/confirm',
        body: { code: '482916' },
      });
      await expect(readEmailVerified(mounted.database)).resolves.toBe(true);
    });

    it('puts a bad code on the Code field, not in a banner', async () => {
      handler = async () => apiError(400, 'invalid_verification_code');
      await typeInto('verify-email-code', '482916');
      await pressOn('verify-email-submit');

      expect(await screen.findByText(COPY.verifyEmail.invalidCode)).toBeTruthy();
      expect(screen.queryByTestId('verify-email-banner')).toBeNull();
      expect(routerRecord.back).toBe(0);
    });

    it('names the blocked action when offline', async () => {
      handler = async () => {
        throw new NetworkUnavailableError(new Error('down'));
      };
      await typeInto('verify-email-code', '482916');
      await pressOn('verify-email-submit');

      expect(await screen.findByText(COPY.verifyEmail.offline)).toBeTruthy();
    });

    it('shows the throttle as a banner and anything else as the generic one', async () => {
      handler = async () => apiError(429, 'rate_limited');
      await typeInto('verify-email-code', '482916');
      await pressOn('verify-email-submit');
      expect(await screen.findByText(COPY.account.tooManyAttempts)).toBeTruthy();

      handler = async () => apiError(500, 'internal_error');
      await pressOn('verify-email-submit');
      expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    });

    it('asks for a new code', async () => {
      handler = async () => ok(204, undefined);
      await pressOn('verify-email-resend');

      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toMatchObject({ method: 'post', path: '/v1/me/email-verification' });
    });
  });
});
