import { applyLocalMutation } from '@/db/write';
import type { CategoryRow, ExpenseRow } from '@/db/entities';
import { drainOutbox } from '@/sync/push';
import { listNeedsAttention } from '@/sync/rejections';
import { readOutboxBatch } from '@/sync/outbox';
import type { TestDatabase } from '../support/sqlite';
import {
  applied,
  categoryId,
  conflicted,
  createFakeSyncApi,
  createSyncDatabase,
  expenseId,
  invalid,
  pushResponse,
  serverCategory,
  serverExpense,
  type FakeSyncApi,
} from '../support/sync';

/**
 * The drain, against the five rules in `src/sync/push.ts`.
 *
 * Each case is written so that it fails against the *natural* wrong implementation
 * rather than against an absurd one - results answered out of order, an `invalid` whose
 * authoritative row was thrown away, a retry that mints a fresh idempotency key. A test
 * that only rules out nonsense would pass against every bug worth having a test for.
 */

const CAT_1 = categoryId(1);
const EXP_1 = expenseId(1);

const AT = new Date('2026-10-15T10:00:00.000Z');
const LATER = new Date('2026-10-15T10:05:00.000Z');

let database: TestDatabase;
let api: FakeSyncApi;

beforeEach(async () => {
  database = await createSyncDatabase();
  api = createFakeSyncApi();
});

afterEach(() => {
  database.close();
});

function deps(clock: () => Date = () => AT) {
  return { database, api, clock };
}

async function readCategory(id: string): Promise<CategoryRow | null> {
  return await database.getFirstAsync<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
}

async function readExpense(id: string): Promise<ExpenseRow | null> {
  return await database.getFirstAsync<ExpenseRow>('SELECT * FROM expenses WHERE id = ?', [id]);
}

async function queueCategory(
  id: string,
  fields: { name?: string; color?: string; deletedAt?: string | null },
  options: { clock?: () => Date; mutationId?: string } = {},
): Promise<string> {
  const queued = await applyLocalMutation(
    database,
    { entity: 'category', id, fields },
    {
      clock: options.clock ?? (() => AT),
      ...(options.mutationId === undefined ? {} : { newMutationId: () => options.mutationId! }),
    },
  );
  return queued.clientMutationId;
}

describe('push ordering', () => {
  it('sends categories before the expenses that may reference them', async () => {
    // Queued in the order a user would produce them if the category were created last,
    // which is exactly the order a FIFO-only drain would send.
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id: EXP_1,
        fields: { categoryId: CAT_1, amountMinor: 1250, currency: 'USD', date: '2026-10-08' },
      },
      { clock: () => AT },
    );
    await queueCategory(CAT_1, { name: 'Groceries', color: '#4f8a4f' });

    await drainOutbox(deps());

    expect(api.pushes).toHaveLength(1);
    expect(api.pushes[0]?.changes.map((change) => change.entity)).toEqual(['category', 'expense']);
  });

  it('keeps FIFO order within an entity, by seq', async () => {
    await queueCategory(categoryId(1), { name: 'A', color: '#4f8a4f' });
    await queueCategory(categoryId(2), { name: 'B', color: '#4f8a4f' });
    await queueCategory(categoryId(3), { name: 'C', color: '#4f8a4f' });

    await drainOutbox(deps());

    expect(api.pushes[0]?.changes.map((change) => change.id)).toEqual([
      categoryId(1),
      categoryId(2),
      categoryId(3),
    ]);
  });
});

describe('per-record results', () => {
  it('clears the entry and stores the server row on applied', async () => {
    await queueCategory(CAT_1, { name: 'Groceries', color: '#4f8a4f' });

    api.pushHandler = (body) =>
      pushResponse([
        applied(body.changes[0]!.clientMutationId, {
          entity: 'category',
          record: serverCategory({
            id: CAT_1,
            name: 'Groceries',
            createdAt: '2026-10-15T10:00:01.000Z',
            updatedAt: '2026-10-15T10:00:01.000Z',
            revision: 7,
          }),
        }),
      ]);

    const outcome = await drainOutbox(deps());

    expect(outcome).toMatchObject({ applied: 1, conflicted: 0, rejected: 0, drained: true });
    expect(await readOutboxBatch(database)).toHaveLength(0);
    // `revision` and `createdAt` are server-owned and were NULL/0 before the round trip.
    // Writing them back is what stops the next pull re-delivering this row.
    expect(await readCategory(CAT_1)).toMatchObject({ revision: 7, name: 'Groceries' });
  });

  it('overwrites the local row with the server row on conflict_server_wins', async () => {
    await queueCategory(CAT_1, { name: 'My name', color: '#4f8a4f' });

    api.pushHandler = (body) =>
      pushResponse([
        conflicted(body.changes[0]!.clientMutationId, {
          entity: 'category',
          record: serverCategory({
            id: CAT_1,
            name: 'Their name',
            updatedAt: '2026-10-15T11:00:00.000Z',
            revision: 9,
          }),
        }),
      ]);

    const outcome = await drainOutbox(deps());

    expect(outcome).toMatchObject({ applied: 0, conflicted: 1 });
    // The local edit lost and the client converges on the server's row rather than
    // keeping a value no other device will ever see.
    expect(await readCategory(CAT_1)).toMatchObject({ name: 'Their name', revision: 9 });
    expect(await readOutboxBatch(database)).toHaveLength(0);
  });

  it('retires an invalid entry instead of retrying it forever, and records why', async () => {
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id: EXP_1,
        fields: { categoryId: CAT_1, amountMinor: 1250, currency: 'USD', date: '2026-10-08' },
      },
      { clock: () => AT },
    );

    api.pushHandler = (body) =>
      pushResponse([
        invalid(body.changes[0]!.clientMutationId, {
          entity: 'expense',
          id: EXP_1,
          code: 'unknown_category',
          message: 'No such category',
        }),
      ]);

    const outcome = await drainOutbox(deps());

    expect(outcome).toMatchObject({ rejected: 1, drained: true });
    expect(await readOutboxBatch(database)).toHaveLength(0);
    expect(await listNeedsAttention(database)).toEqual([
      {
        entity: 'expense',
        recordId: EXP_1,
        code: 'unknown_category',
        message: 'No such category',
        rejectedAt: AT.toISOString(),
      },
    ]);
    // The row itself survives. It is a real expense the user made and it still counts
    // toward the month total (`02-offline-and-sync.md` §5.1).
    expect(await readExpense(EXP_1)).not.toBeNull();
  });

  it('writes back the authoritative row carried by an invalid result', async () => {
    // `mutation_id_reused` is `invalid` and still carries the row the server stored. A
    // drain that only applies `applied` and `conflict_server_wins` throws it away, and
    // the local row then disagrees with the server with nothing left to notice it.
    await queueCategory(CAT_1, { name: 'Coffee beans', color: '#4f8a4f' });

    api.pushHandler = (body) =>
      pushResponse([
        invalid(body.changes[0]!.clientMutationId, {
          entity: 'category',
          id: CAT_1,
          code: 'mutation_id_reused',
          record: serverCategory({ id: CAT_1, name: 'Coffee', revision: 4 }),
        }),
      ]);

    await drainOutbox(deps());

    expect(await readCategory(CAT_1)).toMatchObject({ name: 'Coffee', revision: 4 });
  });

  it('clears a standing rejection once the row pushes cleanly', async () => {
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id: EXP_1,
        fields: { categoryId: CAT_1, amountMinor: 1250, currency: 'USD', date: '2026-10-08' },
      },
      { clock: () => AT },
    );
    api.pushHandler = (body) =>
      pushResponse([
        invalid(body.changes[0]!.clientMutationId, {
          entity: 'expense',
          id: EXP_1,
          code: 'unknown_category',
        }),
      ]);
    await drainOutbox(deps());
    expect(await listNeedsAttention(database)).toHaveLength(1);

    // The user repairs the row, which re-queues it.
    await applyLocalMutation(
      database,
      { entity: 'expense', id: EXP_1, fields: { categoryId: categoryId(2) } },
      { clock: () => LATER },
    );
    // Re-queued is enough to stop showing the marker, before any push happens.
    expect(await listNeedsAttention(database)).toHaveLength(0);

    api.pushHandler = (body) =>
      pushResponse([
        applied(body.changes[0]!.clientMutationId, {
          entity: 'expense',
          record: serverExpense({ id: EXP_1, categoryId: categoryId(2), revision: 3 }),
        }),
      ]);
    await drainOutbox(deps(() => LATER));

    expect(await listNeedsAttention(database)).toHaveLength(0);
    expect(
      await database.getFirstAsync('SELECT 1 FROM sync_rejections WHERE recordId = ?', [EXP_1]),
    ).toBeNull();
  });
});

describe('matching results back to entries', () => {
  it('matches on clientMutationId, not on position', async () => {
    const first = await queueCategory(categoryId(1), { name: 'First', color: '#4f8a4f' });
    const second = await queueCategory(categoryId(2), { name: 'Second', color: '#4f8a4f' });

    // Answered in the opposite order. A positional drain files each row under the other
    // one's id and both end up wrong, with nothing failing.
    api.pushHandler = () =>
      pushResponse([
        applied(second, {
          entity: 'category',
          record: serverCategory({ id: categoryId(2), name: 'Second (server)', revision: 2 }),
        }),
        applied(first, {
          entity: 'category',
          record: serverCategory({ id: categoryId(1), name: 'First (server)', revision: 1 }),
        }),
      ]);

    await drainOutbox(deps());

    expect(await readCategory(categoryId(1))).toMatchObject({ name: 'First (server)' });
    expect(await readCategory(categoryId(2))).toMatchObject({ name: 'Second (server)' });
  });

  it('applies several results for one row in the order the items were sent', async () => {
    // Two edits to the same category, appended rather than coalesced. The second is the
    // one the user made last and the one that must survive locally.
    await queueCategory(CAT_1, { name: 'Groceries', color: '#4f8a4f' }, { clock: () => AT });
    const latest = await queueCategory(CAT_1, { name: 'Food' }, { clock: () => LATER });
    const [, secondSent] = (await readOutboxBatch(database)).map((entry) => entry.clientMutationId);
    expect(secondSent).toBe(latest);

    // Answered newest-first. A drain that writes back in *response* order stores the
    // older row and the list shows a name the user replaced.
    api.pushHandler = (body) => {
      const sent = body.changes.map((change) => change.clientMutationId);
      return pushResponse([
        applied(sent[1]!, {
          entity: 'category',
          record: serverCategory({ id: CAT_1, name: 'Food', revision: 2 }),
        }),
        applied(sent[0]!, {
          entity: 'category',
          record: serverCategory({ id: CAT_1, name: 'Groceries', revision: 1 }),
        }),
      ]);
    };

    await drainOutbox(deps());

    expect(await readCategory(CAT_1)).toMatchObject({ name: 'Food', revision: 2 });
  });

  it('leaves an entry the server did not answer queued, and stops the loop', async () => {
    await queueCategory(categoryId(1), { name: 'Answered', color: '#4f8a4f' });
    await queueCategory(categoryId(2), { name: 'Ignored', color: '#4f8a4f' });

    api.pushHandler = (body) =>
      pushResponse([
        applied(body.changes[0]!.clientMutationId, {
          entity: 'category',
          record: serverCategory({ id: categoryId(1), name: 'Answered' }),
        }),
      ]);

    const outcome = await drainOutbox(deps());

    expect(outcome).toMatchObject({ batches: 1, applied: 1, drained: false });
    expect((await readOutboxBatch(database)).map((entry) => entry.recordId)).toEqual([
      categoryId(2),
    ]);
  });
});

describe('retries and transport failures', () => {
  it('re-sends the same clientMutationId after a dropped response', async () => {
    await queueCategory(CAT_1, { name: 'Groceries', color: '#4f8a4f' });
    const [queued] = await readOutboxBatch(database);

    api.pushHandler = () => {
      throw new Error('socket hang up');
    };
    await expect(drainOutbox(deps())).rejects.toThrow('socket hang up');

    // The server may well have applied the first attempt; only the answer was lost. The
    // retry must carry the *same* idempotency key, or the write lands twice.
    api.pushHandler = (body) =>
      pushResponse([
        applied(body.changes[0]!.clientMutationId, {
          entity: 'category',
          record: serverCategory({ id: CAT_1, name: 'Groceries', revision: 1 }),
        }),
      ]);
    await drainOutbox(deps());

    expect(api.pushes).toHaveLength(2);
    expect(api.pushes[1]?.changes[0]?.clientMutationId).toBe(queued?.clientMutationId);
    expect(await readOutboxBatch(database)).toHaveLength(0);
  });

  it('keeps the entry queued and records the attempt when the push throws', async () => {
    await queueCategory(CAT_1, { name: 'Groceries', color: '#4f8a4f' });
    api.pushHandler = () => {
      throw new Error('Network request failed');
    };

    await expect(drainOutbox(deps())).rejects.toThrow('Network request failed');

    const [entry] = await readOutboxBatch(database);
    expect(entry).toMatchObject({ attempts: 1, lastError: 'Network request failed' });
    // Nothing local changed. The row is still there and still pending.
    expect(await readCategory(CAT_1)).toMatchObject({ name: 'Groceries', revision: 0 });
  });
});

describe('entries that cannot be sent at all', () => {
  it('retires an entry whose stored fields will not parse, without blocking the queue', async () => {
    await queueCategory(categoryId(1), { name: 'Broken', color: '#4f8a4f' });
    await queueCategory(categoryId(2), { name: 'Fine', color: '#4f8a4f' });
    await database.runAsync('UPDATE outbox SET fields = ? WHERE recordId = ?', [
      'not json',
      categoryId(1),
    ]);

    const outcome = await drainOutbox(deps());

    expect(outcome).toMatchObject({ rejected: 1, applied: 1, drained: true });
    // The healthy entry behind it still went out, in its own batch.
    expect(api.pushes[0]?.changes.map((change) => change.id)).toEqual([categoryId(2)]);
    expect(await listNeedsAttention(database)).toMatchObject([
      { recordId: categoryId(1), code: 'validation_error' },
    ]);
  });
});
