import * as SecureStore from 'expo-secure-store';
import type { StoredSession, TokenStore } from './sessionRecord';

/**
 * Where the session lives between app launches.
 *
 * `expo-secure-store` is Keychain on iOS and the Android Keystore-backed
 * EncryptedSharedPreferences on Android, so the tokens are not readable from a backup or
 * from another app's sandbox. `AsyncStorage` would be plaintext on disk.
 *
 * Two details that matter:
 *
 * - **`AFTER_FIRST_UNLOCK`**, not the stricter `WHEN_UNLOCKED`. A background sync task
 *   can be woken while the phone is locked in a pocket, and with `WHEN_UNLOCKED` the
 *   read fails and the sync silently does nothing. `AFTER_FIRST_UNLOCK` still means the
 *   data is unreadable until the user has unlocked the device at least once since boot.
 * - **One key per value, not one blob.** Android's secure store warns and degrades above
 *   roughly 2 KB per value; a JWT plus a refresh token plus metadata gets close enough to
 *   that to be worth not finding out in the field.
 *
 * This file is the only `expo-secure-store` import in the repo, and that is deliberate:
 * the import resolves to `react-native/index.js`, which vite and tsx cannot parse, so
 * importing anything from here at all confines the importer to a React Native runtime.
 * The session *shape* - `StoredSession`, `TokenStore`, `sessionFromTokenPair` and the
 * in-memory store - therefore lives in `./sessionRecord`, which `session.ts` imports
 * instead (`TVO-33`). Only the wiring in `bootstrap/container.ts` reaches for this file.
 */

const ACCESS_KEY = 'expenseTracker.accessToken';
const REFRESH_KEY = 'expenseTracker.refreshToken';
/**
 * The id of the user the stored tokens belong to.
 *
 * Not a secret, and kept here anyway: it has to be written, read and cleared in lockstep
 * with the tokens, and a second storage mechanism with its own failure modes is how the
 * two end up disagreeing about who is logged in. It lives here because the client had no
 * record of *whose* session it held at all, which is what made the local-store leak in
 * `TVO-16` undetectable rather than merely unhandled.
 */
const USER_KEY = 'expenseTracker.userId';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

interface StoredToken {
  readonly token: string;
  readonly expiresAt: number;
}

function parseStoredToken(raw: string | null): StoredToken | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredToken).token === 'string' &&
      Number.isFinite((parsed as StoredToken).expiresAt)
    ) {
      return parsed as StoredToken;
    }
  } catch {
    // Fall through: a value we cannot read is a value we do not have.
  }
  return null;
}

export function createSecureTokenStore(): TokenStore {
  return {
    async read(): Promise<StoredSession | null> {
      const [access, refresh, userId] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY, SECURE_STORE_OPTIONS),
        SecureStore.getItemAsync(REFRESH_KEY, SECURE_STORE_OPTIONS),
        SecureStore.getItemAsync(USER_KEY, SECURE_STORE_OPTIONS),
      ]);

      const refreshToken = parseStoredToken(refresh);
      // The refresh token is what makes a session a session. Without it the access token
      // is at most an hour of life with no way to renew, so treat it as signed out and
      // let the user log in once rather than an hour from now at a worse moment.
      if (refreshToken === null) return null;

      // A session whose owner cannot be read is treated the same way, which is the
      // conservative branch rather than the convenient one: without an owner there is no
      // way to decide whether the local database belongs to this session, and the cost of
      // guessing wrong is showing one account another account's expenses. The cost of
      // being strict is one login, and it loses nothing - the rows stay on disk, and
      // `localStore.adopt` keeps them if the same user comes back.
      if (userId === null || userId.length === 0) return null;

      const accessToken = parseStoredToken(access);
      return {
        userId,
        // An absent or corrupt access token is recoverable: the first request 401s and
        // the refresh flow replaces it. An empty string is never a usable bearer value,
        // and `accessTokenExpiresAt: 0` marks it already expired.
        accessToken: accessToken?.token ?? '',
        accessTokenExpiresAt: accessToken?.expiresAt ?? 0,
        refreshToken: refreshToken.token,
        refreshTokenExpiresAt: refreshToken.expiresAt,
      };
    },

    async write(session: StoredSession): Promise<void> {
      await Promise.all([
        SecureStore.setItemAsync(USER_KEY, session.userId, SECURE_STORE_OPTIONS),
        SecureStore.setItemAsync(
          ACCESS_KEY,
          JSON.stringify({
            token: session.accessToken,
            expiresAt: session.accessTokenExpiresAt,
          } satisfies StoredToken),
          SECURE_STORE_OPTIONS,
        ),
        SecureStore.setItemAsync(
          REFRESH_KEY,
          JSON.stringify({
            token: session.refreshToken,
            expiresAt: session.refreshTokenExpiresAt,
          } satisfies StoredToken),
          SECURE_STORE_OPTIONS,
        ),
      ]);
    },

    async clear(): Promise<void> {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY, SECURE_STORE_OPTIONS),
        SecureStore.deleteItemAsync(REFRESH_KEY, SECURE_STORE_OPTIONS),
        SecureStore.deleteItemAsync(USER_KEY, SECURE_STORE_OPTIONS),
      ]);
    },
  };
}
