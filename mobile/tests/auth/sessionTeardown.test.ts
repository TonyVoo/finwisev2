import type { AuthResponse, TokenPair } from '@expense-tracker/shared';
import { ApiRequestError } from '@/api/errors';
import { createSessionController } from '@/auth/session';
import { createMemoryTokenStore, sessionFromTokenPair } from '@/auth/sessionRecord';
import { createSqliteLocalStore } from '@/db/localStore';
import { migrate } from '@/db/migrations';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * What happens to the *local database* when a session ends.
 *
 * `session.test.ts` covers what happens to the tokens. This file covers the other half,
 * which is where the user's data lives, and it is deliberately split out because two of
 * these cases arrived as **known defects** — written `it.failing` by QA so they passed
 * while the bug was present and went red the moment it was fixed. `TVO-16` fixed it, so
 * they are now ordinary `it` cases with the assertions QA wrote, plus the user-change case
 * the fix made expressible.
 *
 * Tracked as `AUTH-18` and `AUTH-19` in `docs/qa/TEST_PLAN.md`; the reasoning is under
 * GAP 4 in §11 of the same file. The rule itself, and why it is a wipe rather than a
 * per-user partition, is in `src/db/localStore.ts`.
 */

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');
const WRITTEN_AT = new Date('2026-10-08T10:30:00.000Z');

const CATEGORY_ID = '0192f5a0-0000-7000-8000-0000000000a1';
const EXPENSE_ID = '0192f5a0-0000-7000-8000-0000000000a2';

const USER_A = '0192f5a0-0000-7000-8000-00000000a001';
const USER_B = '0192f5a0-0000-7000-8000-00000000b001';

function tokenPair(suffix: string): TokenPair {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
  };
}

/** What signup and login return: a pair plus the user it belongs to. */
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

describe('ending a session, and the local database', () => {
  let database: TestDatabase;

  /** One category and one expense, both with undrained outbox entries. */
  async function seedUnsyncedWork(): Promise<void> {
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

  async function localRowCounts() {
    const [categories, expenses, outbox] = await Promise.all([
      database.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM categories', []),
      database.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expenses', []),
      database.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox', []),
    ]);
    return {
      categories: categories[0]!.n,
      expenses: expenses[0]!.n,
      outbox: outbox[0]!.n,
    };
  }

  /**
   * A controller over the seeded database. The local store is the real SQLite one, not a
   * fake: what these cases are about is which rows survive, and a fake that answers "I
   * would have deleted them" is not evidence about that.
   */
  function controllerWith(
    stored: { readonly userId: string; readonly pair: TokenPair } | null,
    refreshTokens: (refreshToken: string) => Promise<TokenPair> = async () => tokenPair('2'),
  ) {
    const tokenStore = createMemoryTokenStore(
      stored === null ? null : sessionFromTokenPair(stored.pair, stored.userId, ISSUED_AT),
    );
    const controller = createSessionController({
      tokenStore,
      localStore: createSqliteLocalStore(database),
      refreshTokens,
      clock: () => ISSUED_AT,
    });
    return { controller, tokenStore };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    // Stamped before it is seeded, which is the state a device is really in: the store is
    // claimed when the user signs in, and the rows are written afterwards. Seeding an
    // *unowned* store would be a device whose owner was lost, and `localStore.test.ts`
    // covers that case separately.
    await createSqliteLocalStore(database).adopt(USER_A);
    await seedUnsyncedWork();
  });

  afterEach(() => {
    database.close();
  });

  it('seeds the fixture it claims to', async () => {
    // A fixture that silently builds the wrong state turns every case below into a false
    // green, so it asserts its own postcondition first.
    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
    await expect(createSqliteLocalStore(database).readOwner()).resolves.toBe(USER_A);
  });

  /**
   * `AUTH-12` / `EDGE-08`. This is correct behaviour and the reason it is pinned here: a
   * user who has been offline past the 60-day refresh window is the one most likely to be
   * holding unsynced writes, and the forced clear must not be what destroys them.
   * `02-offline-and-sync.md` §5.3 states the principle — a stale-but-intact local database
   * beats a clean one missing the user's work.
   */
  it('keeps undrained local writes when a refresh fails with token_invalid', async () => {
    const { controller, tokenStore } = controllerWith(
      { userId: USER_A, pair: tokenPair('1') },
      async () => {
        throw new ApiRequestError({ status: 401, code: 'token_invalid', message: 'nope' });
      },
    );
    await controller.initialize();

    await expect(controller.ensureFreshAccessToken(null)).resolves.toBeNull();

    // The session is gone...
    expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: true });
    await expect(tokenStore.read()).resolves.toBeNull();
    // ...and the user's unsynced work is not.
    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
    // Still stamped, so the same user logging back in keeps it (the case below).
    await expect(createSqliteLocalStore(database).readOwner()).resolves.toBe(USER_A);
  });

  /**
   * `AUTH-18` — **known defect.** `04-expense-list.md` §Behaviour rule 14 specifies that
   * logout "revokes the token, clears secure store, **wipes the local database**", and the
   * confirm dialog tells the user `Changes that have not synced yet will be lost.` when the
   * outbox is non-empty. `signOut()` routes through the same `discard()` as the forced
   * clear and clears only the token store, so the warning is shown and nothing is lost.
   *
   * Harmless in isolation — it errs toward keeping the user's data — but it is what left
   * the rows that `AUTH-19` then handed to the next account, so the two were one fix.
   * Closed by making logout match the design rather than by changing the design: the copy
   * deck already promises this data loss, so the alternative was a dialog that lies.
   */
  it('wipes the local database on an explicit logout, as the design specifies', async () => {
    const { controller } = controllerWith({ userId: USER_A, pair: tokenPair('1') });
    await controller.initialize();

    await controller.signOut();

    expect(await localRowCounts()).toEqual({ categories: 0, expenses: 0, outbox: 0 });
    // Unowned, not reassigned: nobody is signed in, so the store belongs to nobody.
    await expect(createSqliteLocalStore(database).readOwner()).resolves.toBeNull();
  });

  /**
   * `AUTH-19` — **known defect, and the one that matters.** The client has no notion of
   * *whose* local data it holds: `StoredSession` carries only tokens, `signIn()` takes a
   * bare `TokenPair` and drops the `user` that `AuthResponse` returns alongside it, and no
   * local table has a `userId` column. `openLocalDatabase()` opens one fixed file for
   * whoever is signed in.
   *
   * So a second account on the same device inherits the first's categories and expenses,
   * and once the sync drain lands it will push the first user's undrained outbox under the
   * second user's bearer token. The server scopes rows to the authenticated user and will
   * faithfully file one account's spending into another's.
   *
   * This asserts the precondition the fix needed: a persisted user identity. Without one,
   * neither partitioning the database nor wiping it on a user change is expressible.
   */
  it('persists which user the session belongs to, so a user change is detectable', async () => {
    const { controller, tokenStore } = controllerWith(null);
    await controller.initialize();

    await controller.signIn(authResponse(USER_A, 'user-a'));
    const stored = await tokenStore.read();

    expect(stored).not.toBeNull();
    expect(Object.keys(stored!)).toContain('userId');
    expect(stored!.userId).toBe(USER_A);
  });

  /**
   * `AUTH-19`, the defect itself, at the layer where it is decided.
   *
   * The E2E case reads Home and Categories; this is the same event one level down — the
   * sign-in that used to hand `b@x.com` the rows `a@x.com` left behind. It asserts the
   * wipe happens *as part of* `signIn`, which is the half that matters: a clean-up that
   * ran any later would already have published an authenticated session over another
   * user's data, and the tab bar reads SQLite on its first frame.
   */
  it('wipes the previous account data when a different user signs in', async () => {
    // `a@x.com` is gone from secure store — they logged out, or their refresh token
    // expired — but their rows are still on disk.
    const { controller } = controllerWith(null);
    await controller.initialize();
    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });

    await controller.signIn(authResponse(USER_B, 'user-b'));

    expect(await localRowCounts()).toEqual({ categories: 0, expenses: 0, outbox: 0 });
    await expect(createSqliteLocalStore(database).readOwner()).resolves.toBe(USER_B);
  });

  /**
   * The other half of `AUTH-19`, and the one that is easy to break while fixing it. A user
   * whose session expired while offline logs in again on the same device: their undrained
   * writes are the only copy, and they must drain, not vanish. `AUTH-12` asserts the
   * forced clear keeps them; this asserts the re-login does too.
   */
  it('keeps the data when the same user signs in again', async () => {
    const { controller } = controllerWith(null);
    await controller.initialize();

    await controller.signIn(authResponse(USER_A, 'user-a'));

    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
  });

  /**
   * A sign-in that cannot adopt the store must not become a session. Otherwise the user is
   * signed in over rows that may not be theirs, with nothing left to re-check: the
   * authenticated snapshot is published and the screens read.
   */
  it('does not sign in when the local store cannot be adopted', async () => {
    const tokenStore = createMemoryTokenStore(null);
    const controller = createSessionController({
      tokenStore,
      localStore: {
        readOwner: async () => USER_A,
        adopt: () => Promise.reject(new Error('disk full')),
        clear: async () => undefined,
      },
      refreshTokens: async () => tokenPair('2'),
      clock: () => ISSUED_AT,
    });
    await controller.initialize();

    await expect(controller.signIn(authResponse(USER_B, 'user-b'))).rejects.toThrow('disk full');

    expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: false });
    await expect(tokenStore.read()).resolves.toBeNull();
    // And the previous user's rows are untouched, rather than half-deleted.
    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
  });
});
