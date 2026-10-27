import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { NetworkUnavailableError } from '@/api/errors';
import type { Transport, TransportRequest } from '@/api/transport';
import { COPY, GENERIC_ERROR, VALIDATION_COPY } from '@/copy/strings';
import { OWNER_KEY } from '@/db/localStore';
import { queryKeys } from '@/query/keys';
import ChangePasswordScreen from '../../app/(app)/settings/change-password';
import ChangeEmailScreen from '../../app/(app)/settings/change-email';
import DeleteAccountScreen from '../../app/(app)/settings/delete-account';
import { resetRouter, routerRecord } from '../support/router';
import {
  apiError,
  authResponse,
  mountScreen,
  ok,
  pressOn,
  secureStore,
  tokenPair,
  typeInto,
  type MountedScreen,
} from '../support/mount';

jest.mock('expo-router');

/**
 * Change password and delete account, through their screens.
 *
 * Both are online-only and both are destructive in some way, so what these cases pin is
 * the part that is easy to get subtly wrong: the *consequences* on this device. A password
 * change must leave the user signed in on a working token pair (the old refresh token was
 * revoked server-side), and a deletion must leave nothing behind and nobody signed in.
 */

const EMPTY_PAGE = {
  changes: [],
  nextCursor: 0,
  hasMore: false,
  resyncRequired: false,
  serverTime: '2026-10-26T09:00:00.000Z',
};

describe('account screens', () => {
  let mounted: MountedScreen;
  let requests: TransportRequest[];
  let handler: (request: TransportRequest) => ReturnType<Transport>;

  const transport: Transport = async (request) => {
    if (request.path === '/v1/sync') return ok(200, EMPTY_PAGE);
    requests.push(request);
    return handler(request);
  };

  async function mountSignedIn(element: React.ReactElement): Promise<void> {
    mounted = await mountScreen(element, { transport });
    await mounted.container.session.signIn(authResponse());
    await mounted.container.sync.sync('manual');
    requests.length = 0;
  }

  beforeEach(() => {
    resetRouter();
    secureStore().clear();
    requests = [];
    handler = async () => {
      throw new Error('unexpected request');
    };
  });

  afterEach(async () => {
    await cleanup();
    mounted.database.close();
  });

  async function outboxCount(): Promise<number> {
    const row = await mounted.database.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM outbox',
      [],
    );
    return row?.count ?? 0;
  }

  const accountRequests = () => requests.filter((r) => r.path.startsWith('/v1/me'));

  describe('change email', () => {
    async function fill(email: string, password: string): Promise<void> {
      await typeInto('change-email-new', email);
      await typeInto('change-email-password', password);
    }

    it('validates locally and sends nothing: malformed, same as current, no password', async () => {
      await mountSignedIn(<ChangeEmailScreen />);
      // The screen mounted before the sign-in wrote the user row; in the app it mounts after.
      await act(async () => {
        await mounted.container.queryClient.invalidateQueries({ queryKey: queryKeys.local() });
      });

      await fill('not-an-email', '');
      await pressOn('change-email-submit');
      expect(screen.getByText(VALIDATION_COPY.email.invalid)).toBeTruthy();
      expect(screen.getByText(VALIDATION_COPY.password.empty)).toBeTruthy();

      await fill('ADA@example.com', 'a-password-1');
      await pressOn('change-email-submit');
      expect(screen.getByText(COPY.account.changeEmail.same)).toBeTruthy();

      expect(accountRequests()).toEqual([]);
    });

    it('sends the normalised email, rewrites the local user and goes back', async () => {
      handler = async () =>
        ok(200, { user: { ...authResponse().user, email: 'grace@example.com' } });
      await mountSignedIn(<ChangeEmailScreen />);

      await fill('  Grace@Example.com ', 'a-password-1');
      await pressOn('change-email-submit');

      await waitFor(() => expect(routerRecord.back).toBe(1));
      expect(accountRequests()[0]).toMatchObject({
        method: 'patch',
        path: '/v1/me/email',
        body: { email: 'grace@example.com', password: 'a-password-1' },
      });
      const row = await mounted.database.getFirstAsync<{ email: string }>(
        'SELECT email FROM user',
        [],
      );
      expect(row?.email).toBe('grace@example.com');
      // Same account, same session.
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
      expect(await mounted.container.session.getAccessToken()).toBe('access-1');
    });

    it('puts a taken address on the email field and a wrong password on its own', async () => {
      handler = async () => apiError(409, 'email_already_exists');
      await mountSignedIn(<ChangeEmailScreen />);
      await fill('taken@example.com', 'a-password-1');
      await pressOn('change-email-submit');
      expect(await screen.findByText(COPY.account.changeEmail.taken)).toBeTruthy();
      expect(routerRecord.back).toBe(0);

      handler = async () => apiError(403, 'forbidden');
      await pressOn('change-email-submit');
      expect(await screen.findByText(COPY.account.wrongPassword)).toBeTruthy();
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
    });

    it('says the action needs a connection when offline', async () => {
      handler = async () => {
        throw new NetworkUnavailableError(new Error('network down'));
      };
      await mountSignedIn(<ChangeEmailScreen />);
      await fill('grace@example.com', 'a-password-1');
      await pressOn('change-email-submit');
      expect(await screen.findByText(COPY.account.changeEmail.offline)).toBeTruthy();
    });
  });

  describe('change password', () => {
    async function fill(current: string, next: string, confirm: string): Promise<void> {
      await typeInto('change-password-current', current);
      await typeInto('change-password-new', next);
      await typeInto('change-password-confirm', confirm);
    }

    it('validates locally and sends nothing: empty, too short, same as current, mismatch', async () => {
      await mountSignedIn(<ChangePasswordScreen />);

      await pressOn('change-password-submit');
      expect(screen.getByText(VALIDATION_COPY.password.empty)).toBeTruthy();
      expect(screen.getByText(VALIDATION_COPY.password.short)).toBeTruthy();

      await fill('old-password-1', 'short', 'short');
      await pressOn('change-password-submit');
      expect(screen.getByText(VALIDATION_COPY.password.short)).toBeTruthy();

      await fill('old-password-1', 'old-password-1', 'old-password-1');
      await pressOn('change-password-submit');
      expect(screen.getByText(COPY.account.changePassword.same)).toBeTruthy();

      await fill('old-password-1', 'brand-new-password', 'brand-new-passwor');
      await pressOn('change-password-submit');
      expect(screen.getByText(COPY.account.changePassword.mismatch)).toBeTruthy();

      expect(accountRequests()).toEqual([]);
    });

    it('sends both passwords, installs the new token pair, and goes back', async () => {
      handler = async () => ok(200, tokenPair('2'));
      await mountSignedIn(<ChangePasswordScreen />);

      await fill('old-password-1', 'brand-new-password', 'brand-new-password');
      await pressOn('change-password-submit');

      await waitFor(() => expect(routerRecord.back).toBe(1));
      expect(accountRequests()).toHaveLength(1);
      expect(accountRequests()[0]).toMatchObject({
        method: 'post',
        path: '/v1/me/password',
        body: { currentPassword: 'old-password-1', newPassword: 'brand-new-password' },
      });

      // The new pair replaced the old one - in memory and in secure store - and the user
      // is still signed in. Without this the next refresh would present a revoked token.
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
      expect(await mounted.container.session.getAccessToken()).toBe('access-2');
      const persisted = [...secureStore().values()].join(' ');
      expect(persisted).toContain('refresh-2');
      expect(persisted).not.toContain('refresh-1');
    });

    it('does not move the epoch: a password change is not a sign-in', async () => {
      handler = async () => ok(200, tokenPair('2'));
      await mountSignedIn(<ChangePasswordScreen />);
      const before = mounted.container.session.getEpoch();

      await fill('old-password-1', 'brand-new-password', 'brand-new-password');
      await pressOn('change-password-submit');
      await waitFor(() => expect(routerRecord.back).toBe(1));

      expect(mounted.container.session.getEpoch()).toBe(before);
    });

    it('puts a wrong current password on its field and stays signed in', async () => {
      handler = async () => apiError(403, 'forbidden');
      await mountSignedIn(<ChangePasswordScreen />);

      await fill('wrong-password', 'brand-new-password', 'brand-new-password');
      await pressOn('change-password-submit');

      expect(await screen.findByText(COPY.account.wrongPassword)).toBeTruthy();
      expect(screen.queryByTestId('change-password-banner')).toBeNull();
      expect(routerRecord.back).toBe(0);
      // A 403 must never be treated as a dead session.
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
      expect(await mounted.container.session.getAccessToken()).toBe('access-1');
    });

    it('says the action needs a connection when offline, and keeps the session', async () => {
      handler = async () => {
        throw new NetworkUnavailableError(new Error('network down'));
      };
      await mountSignedIn(<ChangePasswordScreen />);

      await fill('old-password-1', 'brand-new-password', 'brand-new-password');
      await pressOn('change-password-submit');

      expect(await screen.findByText(COPY.account.changePassword.offline)).toBeTruthy();
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
    });

    it('shows the throttle and the generic fallback as banners', async () => {
      handler = async () => apiError(429, 'rate_limited');
      await mountSignedIn(<ChangePasswordScreen />);
      await fill('old-password-1', 'brand-new-password', 'brand-new-password');
      await pressOn('change-password-submit');
      expect(await screen.findByText(COPY.account.tooManyAttempts)).toBeTruthy();

      handler = async () => apiError(500, 'internal_error');
      await pressOn('change-password-submit');
      expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    });
  });

  describe('delete account', () => {
    async function openConfirmation(password = 'old-password-1'): Promise<void> {
      await typeInto('delete-account-password', password);
      await pressOn('delete-account-submit');
    }

    it('asks for the password first, and sends nothing without it', async () => {
      await mountSignedIn(<DeleteAccountScreen />);

      await pressOn('delete-account-submit');

      expect(screen.getByText(VALIDATION_COPY.password.empty)).toBeTruthy();
      expect(screen.queryByTestId('delete-account-dialog')).toBeNull();
      expect(accountRequests()).toEqual([]);
    });

    it('asks once more in a dialog, and Cancel deletes nothing', async () => {
      await mountSignedIn(<DeleteAccountScreen />);
      await openConfirmation();

      expect(await screen.findByText(COPY.account.deleteAccount.dialogTitle)).toBeTruthy();
      fireEvent.press(await screen.findByTestId('delete-account-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('delete-account-dialog')).toBeNull());

      expect(accountRequests()).toEqual([]);
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
    });

    it('deletes on the server, then signs out and wipes this device', async () => {
      handler = async (request) =>
        request.path === '/v1/me' ? ok(204, undefined) : ok(204, undefined);
      await mountSignedIn(<DeleteAccountScreen />);
      await mounted.database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
         VALUES ('category', 'c-1', '{}', '2026-10-26T09:00:00.000Z', 'm-1', '2026-10-26T09:00:00.000Z')`,
        [],
      );

      await openConfirmation();
      fireEvent.press(await screen.findByTestId('delete-account-dialog-confirm'));

      await waitFor(() => expect(mounted.container.session.getSnapshot().status).toBe('anonymous'));
      const call = accountRequests().find((r) => r.method === 'delete');
      expect(call).toMatchObject({ path: '/v1/me', body: { password: 'old-password-1' } });

      // Nothing of the account is left on the device.
      expect(secureStore().size).toBe(0);
      expect(await outboxCount()).toBe(0);
      const owner = await mounted.database.getFirstAsync<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?',
        [OWNER_KEY],
      );
      expect(owner).toBeNull();
    });

    it('keeps the account, the session and the local data when the password is wrong', async () => {
      handler = async () => apiError(403, 'forbidden');
      await mountSignedIn(<DeleteAccountScreen />);
      await mounted.database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
         VALUES ('category', 'c-1', '{}', '2026-10-26T09:00:00.000Z', 'm-1', '2026-10-26T09:00:00.000Z')`,
        [],
      );

      await openConfirmation('not-the-password');
      fireEvent.press(await screen.findByTestId('delete-account-dialog-confirm'));

      expect(await screen.findByText(COPY.account.wrongPassword)).toBeTruthy();
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
      expect(await outboxCount()).toBe(1);
    });

    it('keeps everything and explains when offline', async () => {
      handler = async () => {
        throw new NetworkUnavailableError(new Error('network down'));
      };
      await mountSignedIn(<DeleteAccountScreen />);

      await openConfirmation();
      fireEvent.press(await screen.findByTestId('delete-account-dialog-confirm'));

      expect(await screen.findByText(COPY.account.deleteAccount.offline)).toBeTruthy();
      expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
      // The button is usable again for a retry.
      await act(async () => undefined);
      expect(screen.getByTestId('delete-account-submit')).toBeTruthy();
    });
  });
});
