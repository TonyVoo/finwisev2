import type { TokenPair } from '@expense-tracker/shared';

/**
 * The shape of a stored session, and the storage interface over it.
 *
 * Split out of `tokenStore.ts` so that this module imports nothing but `shared/`.
 * `tokenStore.ts` holds the only `expo-secure-store` import in the repo, and that import
 * resolves to `expo-modules-core` -> `react-native/index.js`, which is Flow and which
 * neither vite nor tsx can parse. Anything that imported a *value* from there - and
 * `session.ts` imports `sessionFromTokenPair` - was therefore loadable only inside a
 * React Native runtime or mobile's jest environment, however little of
 * `expo-secure-store` it actually touched.
 *
 * That is what kept the real `SessionController` out of
 * `backend/tests/integration.mobileClient.test.ts`: it could be *typed* there after
 * `TVO-23` but never *constructed*, and `createMemoryTokenStore` - which exists purely
 * for tests - was unimportable from one. With the shape and the in-memory store here,
 * `session.ts` loads in a plain node/vite runner, and `API-19`'s sibling case can drive
 * the real controller against a server that really rotates a single-use refresh token
 * (`TVO-33`).
 *
 * Nothing here knows how the session reaches the disk; `createSecureTokenStore` in
 * `tokenStore.ts` is the implementation the app wires in, and the comment there is where
 * the Keychain/Keystore reasoning lives.
 */

/** The persisted session. Expiries are absolute, so a cold start can reason about them. */
export interface StoredSession {
  /**
   * Who this session belongs to. Load-bearing: it is what lets a cold start decide
   * whether the local database it is about to read belongs to this user
   * (`src/db/localStore.ts`).
   */
  readonly userId: string;
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

/**
 * Turn a freshly issued pair into the stored shape, resolving the relative expiry.
 *
 * `userId` is passed separately because the two sources of a pair differ: signup and
 * login return it beside the tokens in `AuthResponse`, while a refresh returns a bare
 * rotated pair and the owner carries over from the session being refreshed.
 */
export function sessionFromTokenPair(
  pair: TokenPair,
  userId: string,
  issuedAt: Date,
): StoredSession {
  return {
    userId,
    accessToken: pair.accessToken,
    accessTokenExpiresAt: issuedAt.getTime() + pair.accessTokenExpiresIn * 1000,
    refreshToken: pair.refreshToken,
    refreshTokenExpiresAt: Date.parse(pair.refreshTokenExpiresAt),
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
