import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { queryKeys } from '@/query/keys';
import { META_KEYS, readMeta } from '@/db/meta';
import type { Transport, TransportRequest } from '@/api/transport';
import SettingsScreen from '../../app/(app)/settings/index';
import { resetRouter, routerRecord } from '../support/router';
import { type MountedScreen, authResponse, mountScreen, ok, secureStore } from '../support/mount';

/**
 * `TVO-35` / `GAP 24` - Settings rule 14: the email row and the `Log out` button.
 *
 * `sessionTeardown.test.ts` proves `signOut()` is correct, and it kept passing while
 * nothing in the app called it - which is how a missing button reached `done` twice. These
 * cases are about the seam: the button exists, the dialog says the right thing for the
 * outbox it is looking at, and confirming it ends the session the way rule 14 lists.
 */

/**
 * The two native modules the export reaches. `File` records what is written to it, and
 * `Sharing` records what is shared; both are reset in `beforeEach`.
 */
const mockFiles: { uri: string; contents: string }[] = [];
const mockShare = jest.fn(async (_uri: string, _options?: unknown) => undefined);
const mockSharingAvailable = jest.fn(async () => true);

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    readonly uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    create(): void {}
    write(contents: string): void {
      mockFiles.push({ uri: this.uri, contents });
    }
  },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockSharingAvailable(),
  shareAsync: (uri: string, options?: unknown) => mockShare(uri, options),
}));

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
    mockFiles.length = 0;
    mockShare.mockClear();
    mockSharingAvailable.mockImplementation(async () => true);
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

  it('lets the person pick a theme, applies it at once and remembers it on the device', async () => {
    await waitFor(() => expect(screen.getByTestId('settings-appearance')).toBeTruthy());
    // Both the Appearance and the Language row start as "Match system", so look at the
    // Appearance row by its own label.
    expect(
      screen.getByLabelText(`${COPY.settings.appearance}, ${COPY.appearance.system}`),
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId('settings-appearance'));
    await waitFor(() => expect(screen.getByTestId('theme-option-dark')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('theme-option-dark'));

    // The row's value changes with it, so the screen is demonstrably re-rendered in the
    // new theme and not merely told about it.
    await waitFor(() => expect(screen.getByText(COPY.appearance.dark)).toBeTruthy());
    await waitFor(async () =>
      expect(await readMeta(mounted.database, META_KEYS.themePreference)).toBe('dark'),
    );
  });

  it('gives every settings row a leading icon', async () => {
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeTruthy());

    const icons = [
      'mail',
      'dollar-sign',
      'tag',
      'repeat',
      'target',
      'moon',
      'globe',
      'lock',
      'download',
      'key',
      'trash-2',
    ];
    for (const name of icons) {
      expect(screen.getByTestId(`row-icon-${name}`, { includeHiddenElements: true })).toBeTruthy();
    }
  });

  it('shows the account email and a Log out button', async () => {
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

  it('opens Change email, Change password and Delete account', async () => {
    fireEvent.press(await screen.findByTestId('settings-email'));
    fireEvent.press(await screen.findByTestId('settings-change-password'));
    fireEvent.press(await screen.findByTestId('settings-delete-account'));

    expect(routerRecord.push).toEqual([
      '/(app)/settings/change-email',
      '/(app)/settings/change-password',
      '/(app)/settings/delete-account',
    ]);
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

  describe('Export expenses', () => {
    async function seedExpense(): Promise<void> {
      await mounted.database.runAsync(
        `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
         VALUES ('c-1', 'Groceries', '#2F8044', 0, '2026-10-01T00:00:00.000Z', 1)`,
        [],
      );
      await mounted.database.runAsync(
        `INSERT INTO expenses (id, categoryId, amountMinor, currency, date, note, updatedAt, revision)
         VALUES ('e-1', 'c-1', 1250, 'USD', '2026-10-08', 'Weekly shop', '2026-10-08T00:00:00.000Z', 1)`,
        [],
      );
    }

    it('offers the export, with its hint', async () => {
      expect(await screen.findByTestId('settings-export')).toBeTruthy();
      expect(screen.getByText(COPY.settings.export)).toBeTruthy();
      expect(screen.getByText(COPY.settings.exportHint)).toBeTruthy();
    });

    it('writes the CSV and opens the share sheet with it', async () => {
      await seedExpense();

      fireEvent.press(await screen.findByTestId('settings-export'));
      await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));

      expect(mockFiles).toHaveLength(1);
      expect(mockFiles[0]?.contents).toContain('2026-10-08,12.50,USD,Groceries,Weekly shop');
      expect(mockShare.mock.calls[0]?.[0]).toBe(mockFiles[0]?.uri);
      expect(mockShare.mock.calls[0]?.[1]).toMatchObject({ mimeType: 'text/csv' });
    });

    it('says so, and writes nothing, when there are no expenses', async () => {
      fireEvent.press(await screen.findByTestId('settings-export'));

      expect(await screen.findByText(COPY.export.empty)).toBeTruthy();
      expect(mockFiles).toEqual([]);
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('says so when the device cannot share files', async () => {
      await seedExpense();
      mockSharingAvailable.mockImplementation(async () => false);

      fireEvent.press(await screen.findByTestId('settings-export'));

      expect(await screen.findByText(COPY.export.unavailable)).toBeTruthy();
      expect(mockFiles).toEqual([]);
    });

    it('reports a failure and can be tried again', async () => {
      await seedExpense();
      mockShare.mockImplementationOnce(async () => {
        throw new Error('share failed');
      });

      fireEvent.press(await screen.findByTestId('settings-export'));
      expect(await screen.findByText(COPY.export.failed)).toBeTruthy();

      fireEvent.press(await screen.findByTestId('settings-export'));
      await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(2));
    });

    it('works with no network at all', async () => {
      await seedExpense();
      requests.length = 0;

      fireEvent.press(await screen.findByTestId('settings-export'));
      await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));

      expect(requests).toEqual([]);
    });
  });
});
