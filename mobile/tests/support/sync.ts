import type {
  Category,
  Expense,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncPushResult,
} from '@expense-tracker/shared';
import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from './sqlite';

/**
 * Fixtures for the sync suites: a migrated store, and a server that answers whatever
 * the case under test needs it to.
 *
 * The API stand-in is a pair of swappable handlers rather than a queue of canned
 * responses, because most of these cases are about the *relationship* between what was
 * sent and what comes back - a result echoing a `clientMutationId` the request actually
 * carried, a page whose `nextCursor` follows the `since` it was asked for. A canned
 * response cannot express that, and a test built on one passes against a drain that
 * matches results by position.
 */

export const SERVER_TIME = '2026-10-15T12:00:00.000Z';

export async function createSyncDatabase(): Promise<TestDatabase> {
  const database = createTestDatabase();
  await migrate(database);
  return database;
}

export function categoryId(sequence: number): string {
  return `0192f5a0-0000-7000-8000-0000000c${sequence.toString().padStart(4, '0')}`;
}

export function expenseId(sequence: number): string {
  return `0192f5a0-0000-7000-8000-0000000e${sequence.toString().padStart(4, '0')}`;
}

export function serverCategory(overrides: Partial<Category> & { id: string }): Category {
  return {
    name: 'Groceries',
    color: '#4f8a4f',
    isDefault: false,
    monthlyBudgetMinor: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    revision: 1,
    ...overrides,
  };
}

export function serverExpense(overrides: Partial<Expense> & { id: string }): Expense {
  return {
    categoryId: categoryId(1),
    amountMinor: 1250,
    currency: 'USD',
    date: '2026-10-08',
    note: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    revision: 1,
    ...overrides,
  };
}

export function pullPage(overrides: Partial<SyncPullResponse> = {}): SyncPullResponse {
  return {
    changes: [],
    nextCursor: 0,
    hasMore: false,
    resyncRequired: false,
    serverTime: SERVER_TIME,
    ...overrides,
  };
}

export function pushResponse(results: readonly SyncPushResult[]): SyncPushResponse {
  return {
    results: [...results],
    serverRevision: results.length,
    serverTime: SERVER_TIME,
  };
}

/** An `applied` result carrying the row the server now holds. */
export function applied(
  clientMutationId: string,
  change: { entity: 'category'; record: Category } | { entity: 'expense'; record: Expense },
): SyncPushResult {
  return {
    ...change,
    clientMutationId,
    id: change.record.id,
    status: 'applied',
    idempotentReplay: false,
    error: null,
  };
}

export function conflicted(
  clientMutationId: string,
  change: { entity: 'category'; record: Category } | { entity: 'expense'; record: Expense },
): SyncPushResult {
  return {
    ...change,
    clientMutationId,
    id: change.record.id,
    status: 'conflict_server_wins',
    idempotentReplay: false,
    error: null,
  };
}

export function invalid(
  clientMutationId: string,
  init: {
    readonly entity: 'category' | 'expense';
    readonly id: string;
    readonly code: 'unknown_category' | 'mutation_id_reused' | 'validation_error';
    readonly message?: string;
    readonly record?: Category | Expense | null;
    readonly idempotentReplay?: boolean;
  },
): SyncPushResult {
  const base = {
    clientMutationId,
    id: init.id,
    status: 'invalid' as const,
    idempotentReplay: init.idempotentReplay ?? false,
    error: { code: init.code, message: init.message ?? 'refused' },
  };
  return init.entity === 'category'
    ? { ...base, entity: 'category', record: (init.record as Category | undefined) ?? null }
    : { ...base, entity: 'expense', record: (init.record as Expense | undefined) ?? null };
}

export interface FakeSyncApi {
  pushSync(body: SyncPushRequest): Promise<SyncPushResponse>;
  pullSync(query?: SyncPullQuery): Promise<SyncPullResponse>;
  /** Every push body, in order. */
  readonly pushes: SyncPushRequest[];
  /** Every pull query, in order. */
  readonly pulls: Array<SyncPullQuery | undefined>;
  pushHandler: (
    body: SyncPushRequest,
    call: number,
  ) => SyncPushResponse | Promise<SyncPushResponse>;
  pullHandler: (
    query: SyncPullQuery | undefined,
    call: number,
  ) => SyncPullResponse | Promise<SyncPullResponse>;
}

export function createFakeSyncApi(): FakeSyncApi {
  const api: FakeSyncApi = {
    pushes: [],
    pulls: [],

    // Default: the server took everything and had nothing to send back. Cases that care
    // replace these.
    pushHandler: (body) =>
      pushResponse(
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
    pullHandler: (query) => pullPage({ nextCursor: query?.since ?? 0 }),

    async pushSync(body) {
      const call = api.pushes.length;
      api.pushes.push(body);
      return await api.pushHandler(body, call);
    },

    async pullSync(query) {
      const call = api.pulls.length;
      api.pulls.push(query);
      return await api.pullHandler(query, call);
    },
  };

  return api;
}
