import * as SecureStore from 'expo-secure-store';
import type { TokenPair } from '@expense-tracker/shared';
import { createSecureTokenStore, sessionFromTokenPair } from '@/auth/tokenStore';

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');

const PAIR: TokenPair = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresIn: 3600,
  refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
};

/** The in-memory stand-in installed by `tests/setup.ts`. */
const mocked = SecureStore as unknown as { __store: Map<string, string> };

describe('sessionFromTokenPair', () => {
  it('resolves the relative access-token expiry to an absolute one', () => {
    // Stored absolute, because the next process to read this has no idea when the pair
    // was issued.
    expect(sessionFromTokenPair(PAIR, ISSUED_AT)).toEqual({
      accessToken: 'access-1',
      accessTokenExpiresAt: ISSUED_AT.getTime() + 3_600_000,
      refreshToken: 'refresh-1',
      refreshTokenExpiresAt: Date.parse('2026-12-07T10:00:00.000Z'),
    });
  });
});

describe('createSecureTokenStore', () => {
  const store = createSecureTokenStore();

  beforeEach(() => {
    mocked.__store.clear();
    jest.clearAllMocks();
  });

  it('round-trips a session', async () => {
    const session = sessionFromTokenPair(PAIR, ISSUED_AT);
    await store.write(session);
    await expect(store.read()).resolves.toEqual(session);
  });

  it('reads as no session before anything is written', async () => {
    await expect(store.read()).resolves.toBeNull();
  });

  it('removes both tokens on clear', async () => {
    await store.write(sessionFromTokenPair(PAIR, ISSUED_AT));
    await store.clear();

    await expect(store.read()).resolves.toBeNull();
    expect(mocked.__store.size).toBe(0);
  });

  /**
   * `AFTER_FIRST_UNLOCK`, not `WHEN_UNLOCKED`. A background sync task is woken while the
   * phone is locked in a pocket; under `WHEN_UNLOCKED` the read fails and the sync
   * silently does nothing, which is indistinguishable from background sync not working.
   */
  it('stores tokens so a locked device can still read them', async () => {
    await store.write(sessionFromTokenPair(PAIR, ISSUED_AT));

    for (const call of jest.mocked(SecureStore.setItemAsync).mock.calls) {
      expect(call[2]).toMatchObject({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    }
  });

  // Android's secure store degrades above roughly 2 KB per value, so the two tokens are
  // stored under separate keys rather than as one JSON blob.
  it('uses one key per token', async () => {
    await store.write(sessionFromTokenPair(PAIR, ISSUED_AT));
    expect([...mocked.__store.keys()].sort()).toEqual([
      'expenseTracker.accessToken',
      'expenseTracker.refreshToken',
    ]);
  });

  describe('recovering from unusable stored values', () => {
    it('reads as no session when the refresh token is corrupt', async () => {
      await store.write(sessionFromTokenPair(PAIR, ISSUED_AT));
      mocked.__store.set('expenseTracker.refreshToken', 'not json');

      // Without a refresh token there is at most an hour of session left and no way to
      // renew it. Better one login now than a forced one at a worse moment.
      await expect(store.read()).resolves.toBeNull();
    });

    it('keeps the session when only the access token is corrupt', async () => {
      await store.write(sessionFromTokenPair(PAIR, ISSUED_AT));
      mocked.__store.set('expenseTracker.accessToken', '{"nope":true}');

      // Recoverable: the first request 401s and the refresh flow mints a new one.
      await expect(store.read()).resolves.toMatchObject({
        accessToken: '',
        accessTokenExpiresAt: 0,
        refreshToken: 'refresh-1',
      });
    });

    it('reads as no session when the stored expiry is not a number', async () => {
      mocked.__store.set(
        'expenseTracker.refreshToken',
        JSON.stringify({ token: 'r', expiresAt: 'soon' }),
      );
      await expect(store.read()).resolves.toBeNull();
    });
  });
});
