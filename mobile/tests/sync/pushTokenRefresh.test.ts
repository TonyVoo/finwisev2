import type { TokenPair } from '@expense-tracker/shared';
import { createApiClient } from '@/api/client';
import { createAuthorizedTransport } from '@/api/authorize';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';
import { createSessionController } from '@/auth/session';
import { createMemoryTokenStore, sessionFromTokenPair } from '@/auth/sessionRecord';
import { createMemoryLocalStore } from '@/db/localStore';
import { applyLocalMutation } from '@/db/write';
import { readOutboxBatch } from '@/sync/outbox';
import { drainOutbox } from '@/sync/push';
import { listNeedsAttention } from '@/sync/rejections';
import type { TestDatabase } from '../support/sqlite';
import {
  applied,
  categoryId,
  createSyncDatabase,
  expenseId,
  pullPage,
  pushResponse,
  serverCategory,
  serverExpense,
} from '../support/sync';

/**
 * `AUTH-10` from §4 of `docs/qa/TEST_PLAN.md`: an expired access token is refreshed
 * transparently mid-action.
 *
 * `tests/api/authorize.test.ts` already covers the interceptor's own rules, including
 * one refresh for many simultaneous 401s - but it covers them against `GET /v1/me` and a
 * stubbed transport. What `AUTH-10` asks about is the drain: a user who adds an expense
 * while the stored token has expired, with **several rows already queued behind it**. The
 * Expect clause names that case specifically - "exactly one refresh call is made, not one
 * per queued outbox row" - because an interceptor that refreshed per request would still
 * satisfy every case in that suite and would still rotate a single-use refresh token N
 * times, with every rotation after the first arriving already revoked.
 *
 * So this is the whole stack below the UI with one fake in it: a real SQLite outbox, the
 * real `drainOutbox`, the real `ApiClient`, the real interceptor and the real session
 * controller, over a transport that answers `401 token_expired` to the stale token and
 * succeeds for the rotated one. The things the case says the user must *not* see - a
 * banner, a re-login prompt, an error - are asserted as the absence of a rejection row
 * and an unbroken `authenticated` session, which is what those would be rendered from.
 */

const ISSUED_AT = new Date('2026-10-15T10:00:00.000Z');
const USER_ID = '0192f5a0-0000-7000-8000-00000000a001';

const STALE = 'access-stale';
const FRESH = 'access-fresh';

const CAT_1 = categoryId(1);
const EXP_1 = expenseId(1);
const EXP_2 = expenseId(2);
const EXP_3 = expenseId(3);

function rotatedPair(): TokenPair {
  return {
    accessToken: FRESH,
    refreshToken: 'refresh-rotated',
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-14T10:00:00.000Z',
  };
}

interface Rig {
  readonly database: TestDatabase;
  readonly api: ReturnType<typeof createApiClient>;
  readonly seen: readonly TransportRequest[];
  readonly refreshCalls: () => number;
  readonly sessionStatus: () => string;
}

/**
 * The transport is the only fake. It answers on the token it was handed rather than on a
 * call count, so "the retry carried the new token" is the thing that makes it succeed -
 * a retry that replayed the stale token would 401 again and the drain would fail, which
 * is the behaviour the case is really about.
 */
async function rig(options: { onRefresh?: () => Promise<void> } = {}): Promise<Rig> {
  const seen: TransportRequest[] = [];
  let refreshCalls = 0;

  const transport: Transport = async (request) => {
    seen.push(request);

    if (request.accessToken === STALE) {
      return {
        status: 401,
        body: { error: { code: 'token_expired', message: 'Access token has expired' } },
        requestId: null,
      } satisfies TransportResponse;
    }

    if (request.method === 'post' && request.path === '/v1/sync') {
      const body = request.body as { changes: { entity: string; id: string; clientMutationId: string; updatedAt: string }[] };
      return {
        status: 200,
        body: pushResponse(
          body.changes.map((change) =>
            change.entity === 'category'
              ? applied(change.clientMutationId, {
                  entity: 'category',
                  record: serverCategory({ id: change.id, updatedAt: change.updatedAt }),
                })
              : applied(change.clientMutationId, {
                  entity: 'expense',
                  record: serverExpense({ id: change.id, updatedAt: change.updatedAt }),
                }),
          ),
        ),
        requestId: null,
      } satisfies TransportResponse;
    }

    return { status: 200, body: pullPage(), requestId: null } satisfies TransportResponse;
  };

  const session = createSessionController({
    tokenStore: createMemoryTokenStore(
      sessionFromTokenPair(
        {
          accessToken: STALE,
          refreshToken: 'refresh-stored',
          accessTokenExpiresIn: 3600,
          refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
        },
        USER_ID,
        ISSUED_AT,
      ),
    ),
    localStore: createMemoryLocalStore({ owner: USER_ID }),
    refreshTokens: async () => {
      refreshCalls += 1;
      await options.onRefresh?.();
      return rotatedPair();
    },
    clock: () => ISSUED_AT,
  });
  await session.initialize();

  return {
    database: await createSyncDatabase(),
    api: createApiClient({ transport: createAuthorizedTransport(transport, session) }),
    seen,
    refreshCalls: () => refreshCalls,
    sessionStatus: () => session.getSnapshot().status,
  };
}

/** The four rows `AUTH-10`'s "add an expense with a queue behind it" produces. */
async function queueFourRows(database: TestDatabase): Promise<void> {
  await applyLocalMutation(
    database,
    { entity: 'category', id: CAT_1, fields: { name: 'Groceries', color: '#4caf50' } },
    { clock: () => ISSUED_AT },
  );
  for (const id of [EXP_1, EXP_2, EXP_3]) {
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id,
        fields: { categoryId: CAT_1, amountMinor: 1250, currency: 'USD', date: '2026-10-15' },
      },
      { clock: () => ISSUED_AT },
    );
  }
}

describe('AUTH-10 — an expired access token during a push', () => {
  let current: Rig;

  afterEach(() => {
    current.database.close();
  });

  it('refreshes once, retries the push, and drains every queued row', async () => {
    current = await rig();
    await queueFourRows(current.database);

    const outcome = await drainOutbox({
      database: current.database,
      api: current.api,
      clock: () => ISSUED_AT,
    });

    // One refresh. Not one per queued row, and not one per batch.
    expect(current.refreshCalls()).toBe(1);

    // Every row reached the server, and the retry is what carried them: the first attempt
    // was answered 401 and nothing was applied from it.
    expect(outcome.applied).toBe(4);
    expect(outcome.rejected).toBe(0);
    expect(outcome.drained).toBe(true);
    expect(await readOutboxBatch(current.database)).toHaveLength(0);

    const pushes = current.seen.filter((r) => r.path === '/v1/sync' && r.method === 'post');
    expect(pushes.map((r) => r.accessToken)).toEqual([STALE, FRESH]);

    // Nothing for the user to see or do: no rejection row to render as an error, and the
    // session never dropped to a state the auth stack would redirect out of.
    expect(await listNeedsAttention(current.database)).toEqual([]);
    expect(current.sessionStatus()).toBe('authenticated');
  });

  it('shares one refresh between a push and a pull that 401 together', async () => {
    // Both halves of a sync pass go out against the same expired token. The refresh token
    // is single-use and rotates, so a second rotation would arrive already revoked and
    // sign the user out - the failure this is really guarding, and the reason the count
    // below is `toBe(1)` rather than `toBeLessThanOrEqual`.
    //
    // The refresh is held open for a tick on purpose. Resolving it immediately would let
    // the first caller finish before the second ever asked, and the case would then pass
    // against a controller with no sharing in it at all - the two refreshes would simply
    // be sequential. Holding it guarantees the second caller arrives mid-flight, which is
    // the only state `inFlightRefresh` exists for.
    current = await rig({
      onRefresh: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      },
    });
    await queueFourRows(current.database);

    const [outcome] = await Promise.all([
      drainOutbox({
        database: current.database,
        api: current.api,
        clock: () => ISSUED_AT,
      }),
      current.api.pullSync({ since: 0 }),
    ]);

    expect(current.refreshCalls()).toBe(1);
    expect(outcome.applied).toBe(4);
    expect(current.sessionStatus()).toBe('authenticated');
  });
});
