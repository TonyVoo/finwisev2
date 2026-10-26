import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { queryKeys } from '@/query/keys';
import type { Transport, TransportRequest } from '@/api/transport';
import SettingsScreen from '../../app/(app)/settings/index';
import { resetRouter } from '../support/router';
import { type MountedScreen, authResponse, mountScreen, ok, secureStore } from '../support/mount';

/**
 * `TVO-35` / `GAP 24` - Settings rule 14: the email row and the `Log out` button.
 *
 * `sessionTeardown.test.ts` proves `signOut()` is correct, and it kept passing while
 * nothing in the app called it - which is how a missing button reached `done` twice. These
 * cases are about the seam: the button exists, the dialog says the right thing for the
 * outbox it is looking at, and confirming it ends the session the way rule 14 lists.
 */

const EMPTY_PAGE = {
  changes: [],
  nextCursor: 0,
  hasMore: false,
  resyncRequired: false,
  serverTime: '2026-10-26T09:00:00.000Z',
};

describe('the settings screen', () => {
  let mounted: MountedScreen;
  let requests: TransportRequest[];

  let logoutUnreachable = false;

  const transport: Transport = async (request) => {
    requests.push(request);
    if (request.path === '/v1/auth/logout') {
      if (logoutUnreachable) throw new Error('network down');
      return ok(204, undefined);
    }
    return ok(200, EMPTY_PAGE);
  };

  beforeEach(async () => {
    resetRouter();
    secureStore().clear();
    requests = [];
    logoutUnreachable = false;
    mounted = await mountScreen(<SettingsScreen />, { transport });
    // A session with a user row, as a signed-in device has. Its own sign-in sync (TVO-34)
    // is let finish first so it cannot interleave with a case's own assertions.
    await mounted.container.session.signIn(authResponse());
    // Joins the sign-in sync (TVO-34) if it is still running, or runs a second, empty one.
    await mounted.container.sync.sync('manual');
    await refreshReads();
    requests.length = 0;
  });

  afterEach(async () => {
    // Unmount before the database goes: a mounted screen's reads would otherwise run
    // against a closed file.
    await cleanup();
    mounted.database.close();
  });

  /** The screen mounted before the sign-in here; in the app it mounts after it. */
  async function refreshReads(): Promise<void> {
    await act(async () => {
      await mounted.container.queryClient.invalidateQueries({ queryKey: queryKeys.local() });
    });
  }

  async function queuePendingChange(): Promise<void> {
    await mounted.database.runAsync(
      `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
       VALUES ('category', 'c-1', '{}', '2026-10-26T09:00:00.000Z', 'm-1', '2026-10-26T09:00:00.000Z')`,
      [],
    );
    await refreshReads();
  }

  it('shows the account email, read-only, and a Log out button', async () => {
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());
    expect(screen.getByText(COPY.settings.email)).toBeTruthy();
    expect(screen.getByTestId('settings-logout')).toBeTruthy();
    expect(screen.getByLabelText(COPY.settings.logout)).toBeTruthy();
  });

  it('asks first, with the plain body when nothing is waiting to sync', async () => {
    fireEvent.press(await screen.findByTestId('settings-logout'));

    expect(await screen.findByText(COPY.logout.title)).toBeTruthy();
    expect(screen.getByText(COPY.logout.bodyClean)).toBeTruthy();
    expect(screen.queryByText(COPY.logout.bodyPending)).toBeNull();
    // Opening the dialog ends nothing.
    expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
  });

  it('warns that unsynced changes will be lost when the outbox is not empty', async () => {
    await queuePendingChange();

    fireEvent.press(await screen.findByTestId('settings-logout'));

    expect(await screen.findByText(COPY.logout.bodyPending)).toBeTruthy();
    expect(screen.queryByText(COPY.logout.bodyClean)).toBeNull();
  });

  it('keeps the session, and tells the server nothing, on Cancel', async () => {
    fireEvent.press(await screen.findByTestId('settings-logout'));
    fireEvent.press(await screen.findByTestId('logout-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('logout-dialog')).toBeNull());

    expect(mounted.container.session.getSnapshot().status).toBe('authenticated');
    expect(requests.filter((r) => r.path === '/v1/auth/logout')).toEqual([]);
  });

  it('still logs out when the server cannot be reached', async () => {
    logoutUnreachable = true;

    fireEvent.press(await screen.findByTestId('settings-logout'));
    fireEvent.press(await screen.findByTestId('logout-dialog-confirm'));
    await waitFor(() => expect(mounted.container.session.getSnapshot().status).toBe('anonymous'));
    await waitFor(() => expect(requests.some((r) => r.path === '/v1/auth/logout')).toBe(true));

    expect(requests.filter((r) => r.path === '/v1/auth/logout')).toHaveLength(1);
    expect(mounted.container.session.getSnapshot().status).toBe('anonymous');
  });
  it('ends the session, wipes the device and revokes the refresh token on confirm', async () => {
    await queuePendingChange();
    fireEvent.press(await screen.findByTestId('settings-logout'));
    fireEvent.press(await screen.findByTestId('logout-dialog-confirm'));
    await waitFor(() => expect(mounted.container.session.getSnapshot().status).toBe('anonymous'));
    await waitFor(() => expect(requests.some((r) => r.path === '/v1/auth/logout')).toBe(true));

    expect(mounted.container.session.getSnapshot().status).toBe('anonymous');
    expect(await mounted.container.session.getAccessToken()).toBeNull();

    const outbox = await mounted.database.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM outbox',
      [],
    );
    expect(outbox?.n).toBe(0);

    const revoke = requests.filter((r) => r.path === '/v1/auth/logout');
    expect(revoke).toHaveLength(1);
    expect(revoke[0]?.body).toEqual({ refreshToken: 'refresh-1' });

    // The query cache is the second copy of the previous account's data.
    expect(
      mounted.container.queryClient.getQueryCache().findAll({ queryKey: queryKeys.local() }),
    ).toHaveLength(0);
  });
});
