import * as Notifications from 'expo-notifications';
import { migrate } from '@/db/migrations';
import { META_KEYS, readMeta } from '@/db/meta';
import { registerPushToken } from '@/notifications/pushToken';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

const mockConstants: { expoConfig: unknown; easConfig: unknown } = {
  expoConfig: null,
  easConfig: null,
};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
    get easConfig() {
      return mockConstants.easConfig;
    },
  },
}));

let database: TestDatabase;
const api = { registerPushToken: jest.fn(async () => undefined) };
const notifications = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
};

beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  jest.clearAllMocks();
  notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
  notifications.getExpoPushTokenAsync.mockResolvedValue({
    data: 'ExponentPushToken[abc123abc123]',
  });
  mockConstants.expoConfig = {
    extra: { eas: { projectId: 'p-1' } },
  };
});

describe('registerPushToken', () => {
  it('sends a new token once, and remembers it', async () => {
    expect(await registerPushToken(api, database, true)).toBe('sent');
    expect(await registerPushToken(api, database, true)).toBe('skipped');

    expect(api.registerPushToken).toHaveBeenCalledTimes(1);
    expect(api.registerPushToken).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'ExponentPushToken[abc123abc123]' }),
    );
    expect(await readMeta(database, META_KEYS.pushToken)).toBe('ExponentPushToken[abc123abc123]');
  });

  it('sends again when the token changes', async () => {
    await registerPushToken(api, database, true);
    notifications.getExpoPushTokenAsync.mockResolvedValue({
      data: 'ExponentPushToken[zzz999zzz999]',
    });

    expect(await registerPushToken(api, database, true)).toBe('sent');
    expect(api.registerPushToken).toHaveBeenCalledTimes(2);
  });

  it('does nothing without an alert to push for, without permission, or without a project id', async () => {
    expect(await registerPushToken(api, database, false)).toBe('skipped');

    notifications.getPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await registerPushToken(api, database, true)).toBe('skipped');

    notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    mockConstants.expoConfig = { extra: {} };
    expect(await registerPushToken(api, database, true)).toBe('skipped');

    expect(api.registerPushToken).not.toHaveBeenCalled();
  });

  it('does nothing where a token cannot be had (Expo Go)', async () => {
    notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('not supported'));
    expect(await registerPushToken(api, database, true)).toBe('skipped');
    expect(api.registerPushToken).not.toHaveBeenCalled();
  });
});
