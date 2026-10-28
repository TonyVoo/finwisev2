import { createApiClient } from '@/api/client';
import { ApiRequestError, ResponseShapeError } from '@/api/errors';
import type { Transport } from '@/api/transport';
import { createSessionController } from '@/auth/session';
import { createMemoryTokenStore } from '@/auth/sessionRecord';
import { createMemoryLocalStore } from '@/db/localStore';

/**
 * What a deployed client does when the server adds a field.
 *
 * `openapi.yaml` states the evolution policy twice. The conventions list says responses
 * are *not* closed "for the client's purposes - ignore fields you do not know", and
 * `docs/api/README.md` says an additive change inside `/v1` - "a new optional field, a
 * new endpoint" - is fine. The landed client does the opposite: every success body is
 * parsed with the `shared/` schema, every one of those is a `z.strictObject`, and an
 * unrecognised key is a {@link ResponseShapeError}.
 *
 * `client.ts` gives the reason: "Both sides ship from the same `shared/` version, so
 * there is no older-client case to stay permissive for." That holds in this monorepo at
 * build time. It does not hold in the field, where the backend deploys and the app is
 * whatever version the user last installed - and this app is built around clients that
 * are *deliberately* weeks stale, with a 60-day refresh window and an offline store.
 *
 * So these cases measure what the additive change the contract calls safe actually does
 * to an installed app, operation by operation. They assert **today's behaviour**, not a
 * preferred fix: GAP 19 is the open question and either answer is defensible. Flip them
 * when it is decided - they are named in the gap for exactly that reason.
 *
 * The existing shape-error cases in `client.test.ts` cover a *missing* field and a
 * *malformed* one. Both are bugs on one side or the other. An **extra** field is not: it
 * is the one change the contract explicitly permits, and nothing had ever sent one.
 */

function clientReturning(body: unknown) {
  const transport: Transport = async () => ({ status: 200, body, requestId: 'req-1' });
  return createApiClient({ transport });
}

const CATEGORY = {
  id: '0192f5a0-0000-7000-8000-000000000001',
  name: 'Groceries',
  color: '#2F8044',
  isDefault: false,
  monthlyBudgetMinor: null,
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
  deletedAt: null,
  revision: 7,
};

const EXPENSE = {
  id: '0192f5a0-0000-7000-8000-0000000000aa',
  categoryId: CATEGORY.id,
  kind: 'expense',
  amountMinor: 1234,
  currency: 'USD',
  originalAmountMinor: null,
  originalCurrency: null,
  date: '2026-10-08',
  note: 'coffee',
  private: false,
  createdBy: null,
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
  deletedAt: null,
  revision: 9,
};

const MUTATION_ID = '0192f5a0-0000-7000-8000-0000000000c1';

const TOKEN_PAIR = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessTokenExpiresIn: 900,
  refreshTokenExpiresAt: '2026-12-08T10:00:00.000Z',
};

const USER = {
  id: '0192f5a0-0000-7000-8000-0000000000b1',
  email: 'a@example.com',
  currency: 'USD',
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('an additive response field, the change the contract calls safe', () => {
  /**
   * API-20 - the envelope gains a field.
   *
   * `totalCount` beside `data`/`nextCursor`/`hasMore` is the most ordinary additive
   * change there is, and a client that ignored it would carry on unaffected. The
   * documented body is parsed in the same case so the rejection is attributable to the
   * one extra key rather than to anything else about the fixture.
   */
  it('API-20 rejects a new optional field on a list envelope', async () => {
    const documented = { data: [EXPENSE], nextCursor: null, hasMore: false };

    await expect(clientReturning(documented).listExpenses()).resolves.toMatchObject({
      hasMore: false,
    });

    await expect(clientReturning({ ...documented, totalCount: 1 }).listExpenses()).rejects.toThrow(
      ResponseShapeError,
    );
  });

  /**
   * API-21 - a resource gains a field.
   *
   * The realistic shape of an additive change: a new column on `expenses` surfacing on
   * the row rather than on the envelope. `z.strictObject` is recursive, so the depth
   * makes no difference - and the error names the path, worth asserting because that
   * string is the only thing a bug report from a device would carry.
   */
  it('API-21 rejects a new field inside a row, and names its path', async () => {
    const error = await clientReturning({
      data: [{ ...EXPENSE, tags: ['work'] }],
      nextCursor: null,
      hasMore: false,
    })
      .listExpenses()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResponseShapeError);
    expect((error as ResponseShapeError).message).toMatch(/tags/);
    expect((error as ResponseShapeError).message).toMatch(/data\.0/);
  });

  /**
   * API-22 - the pull breaks, which is the one that matters.
   *
   * An app that cannot parse `SyncPullResponse` cannot sync at all: local writes stay in
   * the outbox, the sync pill shows pending forever, and nothing surfaces server-side
   * because the failure is in the client's parse. Asserted at both levels, since a new
   * field could land on the envelope or on the row a change carries.
   */
  it('API-22 rejects an additive field on the sync pull, so the device stops syncing', async () => {
    const documented = {
      changes: [{ entity: 'category', record: CATEGORY }],
      nextCursor: 7,
      hasMore: false,
      resyncRequired: false,
      serverTime: '2026-10-08T10:00:01.000Z',
    };

    await expect(clientReturning(documented).pullSync()).resolves.toMatchObject({ nextCursor: 7 });

    await expect(clientReturning({ ...documented, serverRevision: 7 }).pullSync()).rejects.toThrow(
      ResponseShapeError,
    );

    await expect(
      clientReturning({
        ...documented,
        changes: [{ entity: 'category', record: { ...CATEGORY, icon: 'cart' } }],
      }).pullSync(),
    ).rejects.toThrow(ResponseShapeError);
  });

  /**
   * API-23 - the push breaks too.
   *
   * Worse here than on the pull, because the batch has already been applied
   * server-side. The client cannot read the results, so it cannot clear its outbox, and
   * the retry replays ids the server has recorded - correct by `clientMutationId`, but
   * the row never leaves `pending`.
   */
  it('API-23 rejects an additive field on a push result', async () => {
    const documented = {
      results: [
        {
          entity: 'expense',
          clientMutationId: MUTATION_ID,
          id: EXPENSE.id,
          status: 'applied',
          idempotentReplay: false,
          error: null,
          record: EXPENSE,
        },
      ],
      serverRevision: 9,
      serverTime: '2026-10-08T10:00:01.000Z',
    };
    const batch = {
      changes: [
        {
          entity: 'expense' as const,
          id: EXPENSE.id,
          updatedAt: EXPENSE.updatedAt,
          clientMutationId: MUTATION_ID,
          fields: { amountMinor: 1234 },
        },
      ],
    };

    await expect(clientReturning(documented).pushSync(batch)).resolves.toMatchObject({
      serverRevision: 9,
    });

    await expect(
      clientReturning({ ...documented, appliedCount: 1 }).pushSync(batch),
    ).rejects.toThrow(ResponseShapeError);
  });

  /**
   * API-24 - what it costs, measured rather than argued.
   *
   * This is the case that bounds the severity. A `ResponseShapeError` out of the refresh
   * is not an {@link ApiRequestError}, so it is not in `UNRECOVERABLE_CODES` and
   * `performRefresh` rethrows it instead of calling `discard`. The session survives and
   * the local database is untouched: the app is **stuck, not logged out and not wiped**.
   *
   * Asserting it matters in both directions. It is the reason this reads as "every
   * installed app stops working" rather than "every installed app loses the user's
   * unsynced work" - and it is the branch a careless widening of `UNRECOVERABLE_CODES`
   * would break, which would turn an additive field into exactly the data-loss path
   * `AUTH-12` exists to rule out.
   */
  it('API-24 leaves the session intact when the refresh body gains a field', async () => {
    const tokenStore = createMemoryTokenStore();
    const localStore = createMemoryLocalStore();
    const session = createSessionController({
      tokenStore,
      localStore,
      refreshTokens: async () =>
        clientReturning({ ...TOKEN_PAIR, tokenType: 'Bearer' }).refresh({
          refreshToken: 'refresh-1',
        }),
    });

    await session.signIn({ user: USER, ...TOKEN_PAIR });

    const error = await session.ensureFreshAccessToken('access-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResponseShapeError);
    expect(error).not.toBeInstanceOf(ApiRequestError);
    // Still signed in: no `discard`, so the undrained outbox is safe.
    expect(session.getSnapshot().status).toBe('authenticated');
    expect(await tokenStore.read()).not.toBeNull();
  });
});
