import type {
  Category,
  Expense,
  Goal,
  RecurringRule,
  SyncChange,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncPushResult,
} from '@expense-tracker/shared';
import type { Transport, TransportRequest } from '@/api/transport';

/**
 * An in-memory `/v1/sync` that implements the protocol rather than canned answers.
 *
 * It exists for one case the other fixtures cannot express: **two clients converging
 * through one server**. That needs a server with state - a revision sequence, stored rows,
 * last-write-wins over `updatedAt`, remembered `clientMutationId`s - because convergence
 * is a property of what the second client is told about the first client's writes.
 *
 * It is not the real backend and is not a substitute for it. What it is faithful to is
 * `shared/src/sync.ts`, clause by clause:
 *
 * - **Revisions are server-assigned and monotonic**, bumped on every applied write, and
 *   a pull returns rows with `revision > since` ordered by revision ascending.
 * - **A push is an upsert with a merge.** Absent keys are left alone, which is what makes
 *   two devices editing different fields of one row safe.
 * - **`applied` only when the incoming `updatedAt` is strictly newer** than stored;
 *   newer-or-equal stored means `conflict_server_wins`, and both carry the authoritative
 *   row.
 * - **A replayed `clientMutationId` returns the original result** with
 *   `idempotentReplay: true` and applies nothing.
 *
 * Deliberately *not* implemented, because nothing here is about them: the 90-day horizon
 * and `resyncRequired` (`tests/sync/pull.test.ts` drives those), auth, and the
 * `isDefault` category rules.
 */

export const FAKE_SERVER_TIME = '2026-10-16T12:00:00.000Z';

export interface FakeSyncServer {
  /** A {@link Transport} answering `GET`/`POST /v1/sync` and nothing else. */
  readonly transport: Transport;
  /** Every request it answered, in order. */
  readonly requests: TransportRequest[];
  category(id: string): Category | undefined;
  expense(id: string): Expense | undefined;
  recurring(id: string): RecurringRule | undefined;
  goal(id: string): Goal | undefined;
  /** Rows the server holds, live and tombstoned, oldest revision first. */
  snapshot(): ReadonlyArray<SyncChange>;
}

export interface FakeSyncServerOptions {
  /**
   * Changes per pull page. Small by default so a convergence case exercises paging
   * rather than asserting over one page and calling it a pull.
   */
  readonly pageSize?: number;
}

export function createFakeSyncServer(options: FakeSyncServerOptions = {}): FakeSyncServer {
  const pageSize = options.pageSize ?? 2;
  const categories = new Map<string, Category>();
  const expenses = new Map<string, Expense>();
  const rules = new Map<string, RecurringRule>();
  const goals = new Map<string, Goal>();
  const replays = new Map<string, SyncPushResult>();
  const requests: TransportRequest[] = [];
  let revision = 0;

  function ordered(): SyncChange[] {
    const rows: SyncChange[] = [
      ...[...categories.values()].map((record) => ({ entity: 'category' as const, record })),
      ...[...rules.values()].map((record) => ({ entity: 'recurring' as const, record })),
      ...[...goals.values()].map((record) => ({ entity: 'goal' as const, record })),
      ...[...expenses.values()].map((record) => ({ entity: 'expense' as const, record })),
    ];
    return rows.sort((left, right) => left.record.revision - right.record.revision);
  }

  function pull(since: number): SyncPullResponse {
    const pending = ordered().filter((change) => change.record.revision > since);
    const page = pending.slice(0, pageSize);
    const last = page.at(-1);

    return {
      changes: page,
      nextCursor: last?.record.revision ?? since,
      hasMore: pending.length > page.length,
      resyncRequired: false,
      serverTime: FAKE_SERVER_TIME,
    };
  }

  function invalid(item: SyncPushRequest['changes'][number], message: string): SyncPushResult {
    const base = {
      clientMutationId: item.clientMutationId,
      id: item.id,
      status: 'invalid' as const,
      idempotentReplay: false,
      error: { code: 'validation_error' as const, message },
    };
    if (item.entity === 'category') {
      return { ...base, entity: 'category', record: categories.get(item.id) ?? null };
    }
    if (item.entity === 'recurring') {
      return { ...base, entity: 'recurring', record: rules.get(item.id) ?? null };
    }
    if (item.entity === 'goal') {
      return { ...base, entity: 'goal', record: goals.get(item.id) ?? null };
    }
    return { ...base, entity: 'expense', record: expenses.get(item.id) ?? null };
  }

  function applyCategory(
    item: Extract<SyncPushRequest['changes'][number], { entity: 'category' }>,
  ) {
    const stored = categories.get(item.id);

    if (stored === undefined) {
      if (item.fields.name === undefined) {
        return invalid(item, 'name is required to create a category');
      }
      revision += 1;
      const created: Category = {
        id: item.id,
        name: item.fields.name,
        color: item.fields.color ?? '#4f8a4f',
        isDefault: false,
        monthlyBudgetMinor: item.fields.monthlyBudgetMinor ?? null,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        deletedAt: item.fields.deletedAt ?? null,
        revision,
      };
      categories.set(item.id, created);
      return applied(item, { entity: 'category', record: created });
    }

    if (item.updatedAt <= stored.updatedAt) {
      return conflict(item, { entity: 'category', record: stored });
    }

    revision += 1;
    const merged: Category = {
      ...stored,
      name: item.fields.name ?? stored.name,
      color: item.fields.color ?? stored.color,
      monthlyBudgetMinor:
        item.fields.monthlyBudgetMinor === undefined
          ? stored.monthlyBudgetMinor
          : item.fields.monthlyBudgetMinor,
      deletedAt: item.fields.deletedAt === undefined ? stored.deletedAt : item.fields.deletedAt,
      updatedAt: item.updatedAt,
      revision,
    };
    categories.set(item.id, merged);
    return applied(item, { entity: 'category', record: merged });
  }

  function applyRecurring(
    item: Extract<SyncPushRequest['changes'][number], { entity: 'recurring' }>,
  ) {
    const stored = rules.get(item.id);

    if (stored === undefined) {
      const { categoryId, amountMinor, frequency, startDate } = item.fields;
      if (
        categoryId === undefined ||
        amountMinor === undefined ||
        frequency === undefined ||
        startDate === undefined
      ) {
        return invalid(item, 'categoryId, amountMinor, frequency and startDate are required');
      }
      revision += 1;
      const created: RecurringRule = {
        id: item.id,
        categoryId,
        amountMinor,
        currency: item.fields.currency ?? 'USD',
        note: item.fields.note ?? null,
        frequency,
        startDate,
        endDate: item.fields.endDate ?? null,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        deletedAt: item.fields.deletedAt ?? null,
        revision,
      };
      rules.set(item.id, created);
      return applied(item, { entity: 'recurring', record: created });
    }

    if (item.updatedAt <= stored.updatedAt) {
      return conflict(item, { entity: 'recurring', record: stored });
    }

    revision += 1;
    const merged: RecurringRule = {
      ...stored,
      categoryId: item.fields.categoryId ?? stored.categoryId,
      amountMinor: item.fields.amountMinor ?? stored.amountMinor,
      currency: item.fields.currency ?? stored.currency,
      note: item.fields.note === undefined ? stored.note : item.fields.note,
      frequency: item.fields.frequency ?? stored.frequency,
      startDate: item.fields.startDate ?? stored.startDate,
      endDate: item.fields.endDate === undefined ? stored.endDate : item.fields.endDate,
      deletedAt: item.fields.deletedAt === undefined ? stored.deletedAt : item.fields.deletedAt,
      updatedAt: item.updatedAt,
      revision,
    };
    rules.set(item.id, merged);
    return applied(item, { entity: 'recurring', record: merged });
  }

  function applyGoal(item: Extract<SyncPushRequest['changes'][number], { entity: 'goal' }>) {
    const stored = goals.get(item.id);

    if (stored === undefined) {
      const { name, targetMinor } = item.fields;
      if (name === undefined || targetMinor === undefined) {
        return invalid(item, 'name and targetMinor are required to create a goal');
      }
      revision += 1;
      const created: Goal = {
        id: item.id,
        name,
        targetMinor,
        savedMinor: item.fields.savedMinor ?? 0,
        currency: item.fields.currency ?? 'USD',
        deadline: item.fields.deadline ?? null,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        deletedAt: item.fields.deletedAt ?? null,
        revision,
      };
      goals.set(item.id, created);
      return applied(item, { entity: 'goal', record: created });
    }

    if (item.updatedAt <= stored.updatedAt) {
      return conflict(item, { entity: 'goal', record: stored });
    }

    revision += 1;
    const merged: Goal = {
      ...stored,
      name: item.fields.name ?? stored.name,
      targetMinor: item.fields.targetMinor ?? stored.targetMinor,
      savedMinor: item.fields.savedMinor ?? stored.savedMinor,
      currency: item.fields.currency ?? stored.currency,
      deadline: item.fields.deadline === undefined ? stored.deadline : item.fields.deadline,
      deletedAt: item.fields.deletedAt === undefined ? stored.deletedAt : item.fields.deletedAt,
      updatedAt: item.updatedAt,
      revision,
    };
    goals.set(item.id, merged);
    return applied(item, { entity: 'goal', record: merged });
  }

  function applyExpense(item: Extract<SyncPushRequest['changes'][number], { entity: 'expense' }>) {
    const stored = expenses.get(item.id);

    if (stored === undefined) {
      const { categoryId, amountMinor, date, currency } = item.fields;
      if (categoryId === undefined || amountMinor === undefined || date === undefined) {
        return invalid(item, 'categoryId, amountMinor and date are required to create an expense');
      }
      revision += 1;
      const created: Expense = {
        id: item.id,
        categoryId,
        kind: item.fields.kind ?? 'expense',
        amountMinor,
        currency: currency ?? 'USD',
        originalAmountMinor: item.fields.originalAmountMinor ?? null,
        originalCurrency: item.fields.originalCurrency ?? null,
        date,
        note: item.fields.note ?? null,
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        deletedAt: item.fields.deletedAt ?? null,
        revision,
      };
      expenses.set(item.id, created);
      return applied(item, { entity: 'expense', record: created });
    }

    if (item.updatedAt <= stored.updatedAt) {
      return conflict(item, { entity: 'expense', record: stored });
    }

    revision += 1;
    const merged: Expense = {
      ...stored,
      categoryId: item.fields.categoryId ?? stored.categoryId,
      kind: item.fields.kind ?? stored.kind,
      amountMinor: item.fields.amountMinor ?? stored.amountMinor,
      currency: item.fields.currency ?? stored.currency,
      originalAmountMinor:
        item.fields.originalAmountMinor === undefined
          ? stored.originalAmountMinor
          : item.fields.originalAmountMinor,
      originalCurrency:
        item.fields.originalCurrency === undefined
          ? stored.originalCurrency
          : item.fields.originalCurrency,
      date: item.fields.date ?? stored.date,
      note: item.fields.note === undefined ? stored.note : item.fields.note,
      deletedAt: item.fields.deletedAt === undefined ? stored.deletedAt : item.fields.deletedAt,
      updatedAt: item.updatedAt,
      revision,
    };
    expenses.set(item.id, merged);
    return applied(item, { entity: 'expense', record: merged });
  }

  function applied(item: SyncPushRequest['changes'][number], change: SyncChange): SyncPushResult {
    return {
      ...change,
      clientMutationId: item.clientMutationId,
      id: item.id,
      status: 'applied',
      idempotentReplay: false,
      error: null,
    };
  }

  function conflict(item: SyncPushRequest['changes'][number], change: SyncChange): SyncPushResult {
    return {
      ...change,
      clientMutationId: item.clientMutationId,
      id: item.id,
      status: 'conflict_server_wins',
      idempotentReplay: false,
      error: null,
    };
  }

  function push(body: SyncPushRequest): SyncPushResponse {
    // Categories before expenses, as the contract says the server sorts internally - so a
    // client that sent them the other way round still gets a usable answer.
    const rank = { category: 0, recurring: 1, goal: 2, expense: 3 } as const;
    const items = [...body.changes].sort((left, right) => rank[left.entity] - rank[right.entity]);

    const byMutation = new Map<string, SyncPushResult>();
    for (const item of items) {
      const replayed = replays.get(item.clientMutationId);
      if (replayed !== undefined) {
        byMutation.set(item.clientMutationId, { ...replayed, idempotentReplay: true });
        continue;
      }

      const result =
        item.entity === 'category'
          ? applyCategory(item)
          : item.entity === 'recurring'
            ? applyRecurring(item)
            : item.entity === 'goal'
              ? applyGoal(item)
              : applyExpense(item);
      replays.set(item.clientMutationId, result);
      byMutation.set(item.clientMutationId, result);
    }

    // One result per request item, in the order the items were *sent* - not the order the
    // server applied them in.
    return {
      results: body.changes.map((item) => {
        const result = byMutation.get(item.clientMutationId);
        if (result === undefined) throw new Error(`no result for ${item.clientMutationId}`);
        return result;
      }),
      serverRevision: revision,
      serverTime: FAKE_SERVER_TIME,
    };
  }

  const transport: Transport = async (request) => {
    requests.push(request);

    if (request.path !== '/v1/sync') {
      throw new Error(`The fake sync server was asked for ${request.method} ${request.path}`);
    }

    if (request.method === 'get') {
      const since = Number(request.query?.since ?? 0);
      return { status: 200, body: pull(Number.isFinite(since) ? since : 0), requestId: 'req-fake' };
    }

    return { status: 200, body: push(request.body as SyncPushRequest), requestId: 'req-fake' };
  };

  return {
    transport,
    requests,
    category: (id) => categories.get(id),
    expense: (id) => expenses.get(id),
    recurring: (id) => rules.get(id),
    goal: (id) => goals.get(id),
    snapshot: () => ordered(),
  };
}
