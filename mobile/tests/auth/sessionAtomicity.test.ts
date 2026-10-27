import * as SecureStore from 'expo-secure-store';
import type { AuthResponse, TokenPair } from '@expense-tracker/shared';
import { createSessionController } from '@/auth/session';
import { createMemoryTokenStore, sessionFromTokenPair } from '@/auth/sessionRecord';
import { createSecureTokenStore } from '@/auth/tokenStore';
import { createSqliteLocalStore } from '@/db/localStore';
import { migrate } from '@/db/migrations';
import { countPendingRecords, listLiveCategories } from '@/db/queries';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Signing in as somebody else: the read the user actually sees, and the two writes that
 * can fail half-done.
 *
 * `sessionTeardown.test.ts` covers the rule — a different owner wipes, the same owner
 * keeps, a forced clear keeps — by counting rows. This file covers the two places that
 * rule is only as good as the order it runs in, and it is separate because those cases
 * were **known defects**, written `it.failing` so they passed while the bug was present and turned red the
 * moment it is fixed. Flip them to `it` then rather than deleting them; the assertion is
 * already the one the fix has to satisfy.
 *
 * Tracked as `AUTH-20` and `AUTH-21` in `docs/qa/TEST_PLAN.md`, under GAP 11.
 */

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');
const WRITTEN_AT = new Date('2026-10-08T10:30:00.000Z');

const CATEGORY_ID = '0192f5a0-0000-7000-8000-0000000000a1';
const EXPENSE_ID = '0192f5a0-0000-7000-8000-0000000000a2';
const USER_A = '0192f5a0-0000-7000-8000-00000000a001';
const USER_B = '0192f5a0-0000-7000-8000-00000000b001';

/** The in-memory stand-in installed by `tests/setup.ts`. */
const secureStore = SecureStore as unknown as {
  __store: Map<string, string>;
  setItemAsync: jest.Mock;
};

function tokenPair(suffix: string): TokenPair {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
  };
}

function authResponse(userId: string, suffix: string): AuthResponse {
  return {
    user: {
      id: userId,
      email: `${suffix}@example.com`,
      currency: 'USD',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    ...tokenPair(suffix),
  };
}

describe('signing in as a different user', () => {
  let database: TestDatabase;

  /** One category and one expense belonging to `USER_A`, both still undrained. */
  async function seedUserAWork(): Promise<void> {
    let n = 0;
    const options = {
      clock: () => WRITTEN_AT,
      newMutationId: () => `0192f5a0-0000-7000-8000-20000000000${(n += 1)}`,
    };
    await applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
      options,
    );
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id: EXPENSE_ID,
        fields: {
          categoryId: CATEGORY_ID,
          amountMinor: 1250,
          currency: 'USD',
          date: '2026-10-08',
        },
      },
      options,
    );
  }

  function controllerOver(tokenStore = createMemoryTokenStore(null)) {
    return createSessionController({
      tokenStore,
      localStore: createSqliteLocalStore(database),
      refreshTokens: async () => tokenPair('2'),
      clock: () => ISSUED_AT,
    });
  }

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    await createSqliteLocalStore(database).adopt(USER_A);
    await seedUserAWork();
    secureStore.__store.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    database.close();
  });

  /**
   * `AUTH-19` through the queries the screens really call, which is how the defect was
   * reported: not "rows exist on disk" but "Home renders the previous user's expenses and
   * month total, and Categories renders their renamed categories".
   *
   * Not redundant with the row counts in `sessionTeardown.test.ts`. Those would stay green
   * if a later fix partitioned the store instead of wiping it, while these two queries —
   * which carry no `WHERE userId` and are not going to grow one — would start returning
   * another account's rows. This case fails under that change; the counts do not.
   */
  it('shows the new user an empty app, through the read path the screens use', async () => {
    const controller = controllerOver();
    await controller.initialize();
    // Precondition, so this cannot pass by having seeded nothing.
    expect(await listLiveCategories(database)).toHaveLength(1);
    expect(await countPendingRecords(database)).toBe(2);

    await controller.signIn(authResponse(USER_B, 'user-b'));

    expect(await listLiveCategories(database)).toEqual([]);
    expect(await countPendingRecords(database)).toBe(0);
  });

  /**
   * `AUTH-20`. `signIn` wipes the store before it writes the tokens, so a token write that
   * fails has already destroyed the previous user's only copy of their unsynced work — for
   * a sign-in that did not happen. The user is told their login failed; what they are not
   * told is that somebody else's data went with it.
   *
   * `session.ts` claims the opposite in a comment on this exact ordering ("a failure here
   * leaves the user anonymous with their predecessor's data untouched"), which is the
   * reason to pin it: a stated safety property the code does not have is worse than an
   * unstated one, because the next reader stops checking.
   *
   * Reachable without a kill: `expo-secure-store` writes fail on a locked keystore, on a
   * full disk, and on Android keystore corruption after an OS upgrade. The severity is in
   * the outcome rather than the odds — this is the silent loss of the user's own writes
   * that `02-offline-and-sync.md` §5.3 and `AUTH-12` rank above every other failure here.
   *
   * The fix is an ordering, not a new mechanism: write the tokens, then adopt, then
   * publish `authenticated`, clearing the tokens again if the adopt fails. That keeps the
   * property its sibling file asserts — nothing is published before the store is safe to
   * read — and takes the destructive step out of the failure path.
   */
  it(
    'keeps the previous account data when the sign-in cannot store its tokens',
    async () => {
      const controller = createSessionController({
        tokenStore: {
          read: async () => null,
          write: () => Promise.reject(new Error('keychain unavailable')),
          clear: async () => undefined,
        },
        localStore: createSqliteLocalStore(database),
        refreshTokens: async () => tokenPair('2'),
        clock: () => ISSUED_AT,
      });
      await controller.initialize();

      await expect(controller.signIn(authResponse(USER_B, 'user-b'))).rejects.toThrow(
        'keychain unavailable',
      );

      // No session, which is correct and asserted elsewhere too...
      expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: false });
      // ...and USER_A's undrained work is still on disk, which is not.
      expect(await listLiveCategories(database)).toHaveLength(1);
      expect(await countPendingRecords(database)).toBe(2);
      // Nor is the store left claiming an owner who has no session.
      await expect(createSqliteLocalStore(database).readOwner()).resolves.toBe(USER_A);
    },
  );

  /**
   * `AUTH-21`. The owner and the tokens are three independent secure-store values written
   * in parallel, so a write that fails part-way leaves them disagreeing: the owner is the
   * new user while the refresh token is still the old one. `read()` returns that mix
   * happily, and it is a session that is USER_B on the device and USER_A at the server.
   *
   * That re-opens `TVO-16` from the other side. On the next launch `initialize()` adopts
   * USER_B, finds the store already theirs, keeps it and publishes an authenticated
   * session; the first refresh rotates USER_A's refresh token into a valid USER_A pair,
   * and the pull writes USER_A's expenses into a store stamped USER_B. The wipe cannot
   * help — it already ran, for the right user, against the wrong tokens.
   *
   * Cheapest fix is to stop having two sources of truth: keep the owner *inside* the
   * refresh-token value. The refresh token is already what makes a session a session
   * (`read()` returns null without it), it is one `setItemAsync`, and an owner that
   * travels with it cannot disagree with it. The per-value size limit that split these
   * keys apart is not in danger from one uuid.
   */
  it('never reads back a session whose owner disagrees with its tokens', async () => {
    const store = createSecureTokenStore();
    await store.write(sessionFromTokenPair(tokenPair('user-a'), USER_A, ISSUED_AT));

    // USER_B signs in and the refresh-token write is the one that fails. Which of the
    // three fails is incidental; that they are separate writes is the defect.
    const write = secureStore.setItemAsync.getMockImplementation()!;
    secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
      if (key.includes('refreshToken')) throw new Error('keystore write failed');
      return write(key, value);
    });
    await expect(
      store.write(sessionFromTokenPair(tokenPair('user-b'), USER_B, ISSUED_AT)),
    ).rejects.toThrow('keystore write failed');
    secureStore.setItemAsync.mockImplementation(write);

    const session = await store.read();
    const state =
      session === null
        ? 'no session'
        : [
            session.userId === USER_A ? 'owner A' : 'owner B',
            session.refreshToken === 'refresh-user-a' ? 'token A' : 'token B',
          ].join(' + ');

    // Three outcomes cannot mislead anyone: the write landed whole, it did not land, or
    // the half-written session is rejected on read. Only `owner B + token A` can - and it
    // is deliberately not asserted against directly, because a fix that discards the
    // unreadable session is as correct as one that makes the write atomic, and a tripwire
    // that only accepts the author's preferred fix is a tripwire that cries wolf.
    expect(['no session', 'owner A + token A', 'owner B + token B']).toContain(state);
  });
});
