import { AppState, Text } from 'react-native';
import { render, screen, waitFor, act, userEvent } from '@testing-library/react-native';
import { migrate } from '@/db/migrations';
import { META_KEYS, readMeta } from '@/db/meta';
import {
  AppLockProvider,
  LOCK_COVER_TEST_ID,
  LOCK_UNLOCK_TEST_ID,
  useAppLock,
} from '@/lock/AppLockProvider';
import { LOCK_AFTER_MS } from '@/lock/lockModel';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LocalAuthentication = require('expo-local-authentication') as {
  hasHardwareAsync: jest.Mock;
  getEnrolledLevelAsync: jest.Mock;
  authenticateAsync: jest.Mock;
};

function Probe({ onReady }: { onReady: (lock: ReturnType<typeof useAppLock>) => void }) {
  const lock = useAppLock();
  onReady(lock);
  return <Text>content {String(lock.enabled)}</Text>;
}

describe('the app lock', () => {
  let database: TestDatabase;
  let latest: ReturnType<typeof useAppLock>;
  let change: ((state: string) => void) | null = null;

  beforeEach(async () => {
    jest.clearAllMocks();
    LocalAuthentication.hasHardwareAsync.mockResolvedValue(true);
    LocalAuthentication.getEnrolledLevelAsync.mockResolvedValue(2);
    LocalAuthentication.authenticateAsync.mockResolvedValue({ success: true });
    change = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      handler: (state: string) => void,
    ) => {
      change = handler;
      return { remove: jest.fn() };
    }) as never);
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    database.close();
  });

  const mount = async (initialEnabled: boolean) =>
    await render(
      <ThemeProvider>
        <AppLockProvider database={database} initialEnabled={initialEnabled}>
          <Probe onReady={(lock) => (latest = lock)} />
        </AppLockProvider>
      </ThemeProvider>,
    );

  it('shows nothing extra when the lock is off', async () => {
    await mount(false);
    expect(screen.queryByTestId(LOCK_COVER_TEST_ID)).toBeNull();
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
  });

  it('starts covered when on, asks by itself, and uncovers once passed', async () => {
    await mount(true);
    await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId(LOCK_COVER_TEST_ID)).toBeNull());
    // The tree was never unmounted: the content is the same one.
    expect(screen.getByText('content true')).toBeTruthy();
  });

  it('stays covered when the person cancels, and offers another try', async () => {
    LocalAuthentication.authenticateAsync.mockResolvedValue({
      success: false,
      error: 'authentication_failed',
    });
    await mount(true);
    await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId(LOCK_COVER_TEST_ID)).toBeTruthy();
    expect(screen.getByText('Could not unlock. Try again.')).toBeTruthy();

    LocalAuthentication.authenticateAsync.mockResolvedValue({ success: true });
    await userEvent.press(screen.getByTestId(LOCK_UNLOCK_TEST_ID));
    await waitFor(() => expect(screen.queryByTestId(LOCK_COVER_TEST_ID)).toBeNull());
  });

  it('locks again after a long trip to the background, but not after a short one', async () => {
    await mount(true);
    await waitFor(() => expect(screen.queryByTestId(LOCK_COVER_TEST_ID)).toBeNull());
    LocalAuthentication.authenticateAsync.mockClear();

    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await act(async () => change?.('background'));
    now.mockReturnValue(1_000_000 + 1000);
    await act(async () => change?.('active'));
    expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();

    now.mockReturnValue(2_000_000);
    await act(async () => change?.('background'));
    now.mockReturnValue(2_000_000 + LOCK_AFTER_MS);
    await act(async () => change?.('active'));
    await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
  });

  describe('turning it on and off', () => {
    it('verifies the person, saves the setting, and does not cover the screen they are on', async () => {
      await mount(false);
      let result: { status: string } = { status: '' };
      await act(async () => {
        result = await latest.setEnabled(true);
      });
      expect(result.status).toBe('ok');
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
      expect(await readMeta(database, META_KEYS.appLockEnabled)).toBe('1');
      expect(screen.queryByTestId(LOCK_COVER_TEST_ID)).toBeNull();
      expect(latest.enabled).toBe(true);
    });

    it('refuses when the device has nothing to ask for, without prompting', async () => {
      LocalAuthentication.getEnrolledLevelAsync.mockResolvedValue(0);
      await mount(false);
      let result: { status: string } = { status: '' };
      await act(async () => {
        result = await latest.setEnabled(true);
      });
      expect(result.status).toBe('unavailable');
      expect(LocalAuthentication.authenticateAsync).not.toHaveBeenCalled();
      expect(await readMeta(database, META_KEYS.appLockEnabled)).toBeNull();
    });

    it('says nothing when the person simply cancels the prompt', async () => {
      LocalAuthentication.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'user_cancel',
      });
      await mount(false);
      let result: { status: string } = { status: '' };
      await act(async () => {
        result = await latest.setEnabled(true);
      });
      expect(result.status).toBe('cancelled');
      expect(await readMeta(database, META_KEYS.appLockEnabled)).toBeNull();
    });

    it('does not turn it on if the person fails the check', async () => {
      LocalAuthentication.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'not_enrolled',
      });
      await mount(false);
      let result: { status: string } = { status: '' };
      await act(async () => {
        result = await latest.setEnabled(true);
      });
      expect(result).toEqual({ status: 'failed', code: 'not_enrolled' });
      expect(await readMeta(database, META_KEYS.appLockEnabled)).toBeNull();
    });

    it('asks again before turning it off, and clears the setting', async () => {
      await mount(false);
      await act(async () => {
        await latest.setEnabled(true);
      });
      LocalAuthentication.authenticateAsync.mockClear();
      await act(async () => {
        await latest.setEnabled(false);
      });
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1);
      expect(await readMeta(database, META_KEYS.appLockEnabled)).toBeNull();
      expect(latest.enabled).toBe(false);
    });
  });
});
