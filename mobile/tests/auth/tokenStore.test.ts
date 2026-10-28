import * as SecureStore from 'expo-secure-store';
import type { TokenPair } from '@expense-tracker/shared';
import { sessionFromTokenPair } from '@/auth/sessionRecord';
import { createSecureTokenStore } from '@/auth/tokenStore';

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');
const USER_ID = '0192f5a0-0000-7000-8000-00000000a001';

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
    expect(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT)).toEqual({
      userId: USER_ID,
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
    const session = sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT);
    await store.write(session);
    await expect(store.read()).resolves.toEqual(session);
  });

  it('reads as no session before anything is written', async () => {
    await expect(store.read()).resolves.toBeNull();
  });

  it('removes every stored value on clear', async () => {
    await store.write(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT));
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
    await store.write(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT));

    for (const call of jest.mocked(SecureStore.setItemAsync).mock.calls) {
      expect(call[2]).toMatchObject({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    }
  });

  // Android's secure store degrades above roughly 2 KB per value, so each value is
  // stored under its own key rather than as one JSON blob.
  it('uses one key per value', async () => {
    await store.write(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT));
    // The owner travels inside both values (AUTH-21), so there is no third key to disagree.
    expect([...mocked.__store.keys()].sort()).toEqual([
      'expenseTracker.accessToken',
      'expenseTracker.refreshToken',
    ]);
  });

  describe('recovering from unusable stored values', () => {
    it('reads as no session when the refresh token is corrupt', async () => {
      await store.write(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT));
      mocked.__store.set('expenseTracker.refreshToken', 'not json');

      // Without a refresh token there is at most an hour of session left and no way to
      // renew it. Better one login now than a forced one at a worse moment.
      await expect(store.read()).resolves.toBeNull();
    });

    it('keeps the session when only the access token is corrupt', async () => {
      await store.write(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT));
      mocked.__store.set('expenseTracker.accessToken', '{"nope":true}');

      // Recoverable: the first request 401s and the refresh flow mints a new one.
      await expect(store.read()).resolves.toMatchObject({
        accessToken: '',
        accessTokenExpiresAt: 0,
        refreshToken: 'refresh-1',
      });
    });

    /**
     * The strict branch, on purpose. A session whose owner is missing cannot be matched
     * against the local database, so there is no safe way to decide whether the rows on
     * disk belong to it - and guessing wrong shows one account another account's
     * expenses (`TVO-16`). One login costs the user nothing: the rows stay, and
     * `localStore.adopt` keeps them when the same user comes back.
     */
    it('reads as no session when the owner is missing from the refresh token', async () => {
      mocked.__store.set(
        'expenseTracker.refreshToken',
        JSON.stringify({ token: 'r', expiresAt: 1 }),
      );

      await expect(store.read()).resolves.toBeNull();
    });

    it('reads as no session when the owner is empty', async () => {
      mocked.__store.set(
        'expenseTracker.refreshToken',
        JSON.stringify({ token: 'r', expiresAt: 1, userId: '' }),
      );

      await expect(store.read()).resolves.toBeNull();
    });

    it('still reads a session stored by an older build, whose owner had its own key', async () => {
      mocked.__store.set('expenseTracker.userId', USER_ID);
      mocked.__store.set(
        'expenseTracker.refreshToken',
        JSON.stringify({ token: 'r-old', expiresAt: 5 }),
      );

      await expect(store.read()).resolves.toMatchObject({ userId: USER_ID, refreshToken: 'r-old' });
    });

    it('ignores an access token that belongs to a different owner than the refresh token', async () => {
      await store.write(sessionFromTokenPair(PAIR, USER_ID, ISSUED_AT));
      mocked.__store.set(
        'expenseTracker.accessToken',
        JSON.stringify({ token: 'someone-elses', expiresAt: 9e15, userId: 'other-user' }),
      );

      const session = await store.read();
      expect(session?.userId).toBe(USER_ID);
      expect(session?.accessToken).toBe('');
    });

    it('reads as no session when the stored expiry is not a number', async () => {
      mocked.__store.set(
        'expenseTracker.refreshToken',
        JSON.stringify({ token: 'r', expiresAt: 'soon', userId: USER_ID }),
      );
      await expect(store.read()).resolves.toBeNull();
    });
  });
});
