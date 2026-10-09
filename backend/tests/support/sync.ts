import type {
  SyncPullResponse,
  SyncPushItem,
  SyncPushResponse,
  SyncPushResult,
} from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { api } from './api.ts';
import type { TestUser } from './fixtures.ts';

/**
 * Helpers for driving `/v1/sync` over HTTP.
 *
 * Everything goes through the real endpoints, as elsewhere in this suite: the sync
 * guarantees that matter — one transaction, per-record results, the idempotency key
 * enforced by a primary key — only exist at the HTTP and database layers. A test that
 * called the resolver directly would pass with the route unmounted and with the
 * transaction removed.
 */

/** Build one push item, defaulting the bookkeeping fields a test does not care about. */
export function pushItem(
  item: Omit<SyncPushItem, 'updatedAt' | 'clientMutationId'> & {
    updatedAt?: string;
    clientMutationId?: string;
  },
): SyncPushItem {
  return {
    ...item,
    updatedAt: item.updatedAt ?? new Date().toISOString(),
    clientMutationId: item.clientMutationId ?? uuidv7(),
  } as SyncPushItem;
}

export interface PushOutcome {
  readonly status: number;
  readonly body: SyncPushResponse;
  /** The error envelope, for the batch-level failures. */
  readonly error?: { code: string; message: string; details?: unknown };
}

/**
 * `POST /v1/sync`. Deliberately does not assert the status: half these tests are about
 * what a *failing* push answers, per record or per batch.
 */
export async function push(user: Pick<TestUser, 'auth'>, changes: unknown[]): Promise<PushOutcome> {
  const response = await api().post('/v1/sync').set('Authorization', user.auth).send({ changes });
  return {
    status: response.status,
    body: response.body as SyncPushResponse,
    error: (response.body as { error?: PushOutcome['error'] }).error,
  };
}

/** `POST /v1/sync`, asserting the batch itself succeeded. */
export async function pushOk(
  user: Pick<TestUser, 'auth'>,
  changes: unknown[],
): Promise<SyncPushResult[]> {
  const outcome = await push(user, changes);
  if (outcome.status !== 200) {
    throw new Error(`push failed: ${outcome.status} ${JSON.stringify(outcome.body)}`);
  }
  return outcome.body.results;
}

/** `GET /v1/sync`, asserting a 200. */
export async function pull(
  user: Pick<TestUser, 'auth'>,
  query: { since?: number; limit?: number } = {},
): Promise<SyncPullResponse> {
  const params = new URLSearchParams();
  if (query.since !== undefined) params.set('since', String(query.since));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : '';

  const response = await api().get(`/v1/sync${suffix}`).set('Authorization', user.auth);
  if (response.status !== 200) {
    throw new Error(`pull failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as SyncPullResponse;
}

/**
 * Page through `GET /v1/sync` the way a client is told to: keep calling with
 * `since = nextCursor` while `hasMore`.
 *
 * Returns every change seen *and* the number of requests it took, because "did paging
 * deliver each row exactly once" is only answerable if the test can see that more than
 * one page was involved.
 */
export async function pullAll(
  user: Pick<TestUser, 'auth'>,
  options: { limit?: number; from?: number } = {},
): Promise<{ changes: SyncPullResponse['changes']; pages: number; cursor: number }> {
  const changes: SyncPullResponse['changes'] = [];
  let cursor = options.from ?? 0;
  let pages = 0;

  for (;;) {
    const page = await pull(user, {
      since: cursor,
      ...(options.limit ? { limit: options.limit } : {}),
    });
    pages += 1;
    changes.push(...page.changes);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
    if (pages > 50) throw new Error('pullAll did not terminate; hasMore never went false');
  }

  return { changes, pages, cursor };
}

/** The record for one id in a change list, whatever entity it is. */
export function changeFor(
  changes: SyncPullResponse['changes'],
  id: string,
): SyncPullResponse['changes'][number] | undefined {
  return changes.find((change) => change.record.id === id);
}

/** The result for one id, asserting there is exactly one. */
export function resultFor(results: SyncPushResult[], id: string): SyncPushResult {
  const found = results.filter((result) => result.id === id);
  if (found.length !== 1) {
    throw new Error(`expected exactly one result for ${id}, got ${found.length}`);
  }
  return found[0] as SyncPushResult;
}
