import * as SecureStore from 'expo-secure-store';
import type { TokenPair } from '@expense-tracker/shared';

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
 * - **Two keys, not one blob.** Android's secure store warns and degrades above roughly
 *   2 KB per value; a JWT plus a refresh token plus metadata gets close enough to that
 *   to be worth not finding out in the field.
 */

const ACCESS_KEY = 'expenseTracker.accessToken';
const REFRESH_KEY = 'expenseTracker.refreshToken';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** The persisted session. Expiries are absolute, so a cold start can reason about them. */
export interface StoredSession {
  readonly accessToken: string;
  /** Epoch milliseconds. Derived once from `accessTokenExpiresIn` at issue time. */
  readonly accessTokenExpiresAt: number;
  readonly refreshToken: string;
  /** Epoch milliseconds. Roughly 60 days out. */
  readonly refreshTokenExpiresAt: number;
}

export interface TokenStore {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** Turn a freshly issued pair into the stored shape, resolving the relative expiry. */
export function sessionFromTokenPair(pair: TokenPair, issuedAt: Date): StoredSession {
  return {
    accessToken: pair.accessToken,
    accessTokenExpiresAt: issuedAt.getTime() + pair.accessTokenExpiresIn * 1000,
    refreshToken: pair.refreshToken,
    refreshTokenExpiresAt: Date.parse(pair.refreshTokenExpiresAt),
  };
}

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
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY, SECURE_STORE_OPTIONS),
        SecureStore.getItemAsync(REFRESH_KEY, SECURE_STORE_OPTIONS),
      ]);

      const refreshToken = parseStoredToken(refresh);
      // The refresh token is what makes a session a session. Without it the access token
      // is at most an hour of life with no way to renew, so treat it as signed out and
      // let the user log in once rather than an hour from now at a worse moment.
      if (refreshToken === null) return null;

      const accessToken = parseStoredToken(access);
      return {
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
      ]);
    },
  };
}

/** An in-memory {@link TokenStore}, for tests and for the web preview target. */
export function createMemoryTokenStore(initial: StoredSession | null = null): TokenStore {
  let current = initial;
  return {
    read: async () => current,
    write: async (session) => {
      current = session;
    },
    clear: async () => {
      current = null;
    },
  };
}
