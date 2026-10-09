import type { TokenPair } from '@expense-tracker/shared';
import { ApiRequestError } from '@/api/errors';
import { createSessionController } from '@/auth/session';
import { createMemoryTokenStore, sessionFromTokenPair } from '@/auth/tokenStore';
import { migrate } from '@/db/migrations';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * What happens to the *local database* when a session ends.
 *
 * `session.test.ts` covers what happens to the tokens. This file covers the other half,
 * which is where the user's data lives, and it is deliberately split out because two of
 * these cases are **known defects**: they are written as `it.failing`, so they pass while
 * the bug is present and turn red the moment it is fixed. When that happens, flip them to
 * `it` rather than deleting them — the assertion is already the one the fix has to satisfy.
 *
 * Tracked as `AUTH-18` and `AUTH-19` in `docs/qa/TEST_PLAN.md`; the reasoning is under
 * GAP 4 in §11 of the same file.
 */

const ISSUED_AT = new Date('2026-10-08T10:00:00.000Z');
const WRITTEN_AT = new Date('2026-10-08T10:30:00.000Z');

const CATEGORY_ID = '0192f5a0-0000-7000-8000-0000000000a1';
const EXPENSE_ID = '0192f5a0-0000-7000-8000-0000000000a2';

function tokenPair(suffix: string): TokenPair {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
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

  function controllerWith(
    stored: TokenPair | null,
    refreshTokens: (refreshToken: string) => Promise<TokenPair> = async () => tokenPair('2'),
  ) {
    const tokenStore = createMemoryTokenStore(
      stored === null ? null : sessionFromTokenPair(stored, ISSUED_AT),
    );
    const controller = createSessionController({
      tokenStore,
      refreshTokens,
      clock: () => ISSUED_AT,
    });
    return { controller, tokenStore };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    await seedUnsyncedWork();
  });

  afterEach(() => {
    database.close();
  });

  it('seeds the fixture it claims to', async () => {
    // A fixture that silently builds the wrong state turns every case below into a false
    // green, so it asserts its own postcondition first.
    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
  });

  /**
   * `AUTH-12` / `EDGE-08`. This is correct behaviour and the reason it is pinned here: a
   * user who has been offline past the 60-day refresh window is the one most likely to be
   * holding unsynced writes, and the forced clear must not be what destroys them.
   * `02-offline-and-sync.md` §5.3 states the principle — a stale-but-intact local database
   * beats a clean one missing the user's work.
   */
  it('keeps undrained local writes when a refresh fails with token_invalid', async () => {
    const { controller, tokenStore } = controllerWith(tokenPair('1'), async () => {
      throw new ApiRequestError({ status: 401, code: 'token_invalid', message: 'nope' });
    });
    await controller.initialize();

    await expect(controller.ensureFreshAccessToken(null)).resolves.toBeNull();

    // The session is gone...
    expect(controller.getSnapshot()).toEqual({ status: 'anonymous', expired: true });
    await expect(tokenStore.read()).resolves.toBeNull();
    // ...and the user's unsynced work is not.
    expect(await localRowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
  });

  /**
   * `AUTH-18` — **known defect.** `04-expense-list.md` §Behaviour rule 14 specifies that
   * logout "revokes the token, clears secure store, **wipes the local database**", and the
   * confirm dialog tells the user `Changes that have not synced yet will be lost.` when the
   * outbox is non-empty. `signOut()` routes through the same `discard()` as the forced
   * clear and clears only the token store, so the warning is shown and nothing is lost.
   *
   * Harmless in isolation — it errs toward keeping the user's data — but it is what leaves
   * the rows that `AUTH-19` then hands to the next account, so the two are one fix.
   */
  it.failing('wipes the local database on an explicit logout, as the design specifies', async () => {
    const { controller } = controllerWith(tokenPair('1'));
    await controller.initialize();

    await controller.signOut();

    expect(await localRowCounts()).toEqual({ categories: 0, expenses: 0, outbox: 0 });
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
   * This asserts the precondition any fix needs: a persisted user identity. Without one,
   * neither partitioning the database nor wiping it on a user change is expressible.
   */
  it.failing('persists which user the session belongs to, so a user change is detectable', async () => {
    const { controller, tokenStore } = controllerWith(null);
    await controller.initialize();

    await controller.signIn(tokenPair('user-a'));
    const stored = await tokenStore.read();

    expect(stored).not.toBeNull();
    expect(Object.keys(stored!)).toContain('userId');
  });
});
