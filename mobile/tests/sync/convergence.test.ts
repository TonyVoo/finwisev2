import { createApiClient } from '@/api/client';
import { migrate } from '@/db/migrations';
import { createCategory, createExpense, deleteExpense, updateExpense } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryReachability, type MemoryReachability } from '@/sync/reachability';
import { createFakeSyncServer, type FakeSyncServer } from '../support/fakeServer';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import { categoryId, expenseId } from '../support/seed';

/**
 * Two clients, one server: the acceptance criterion's manual check, as far as it can be
 * automated on this host.
 *
 * The criterion asks for a phone taken offline, edited, brought back online, and a
 * *second device* converging on the same state. The device half is unavailable here - no
 * attached device, no booted emulator, no iOS at all on Windows (`TVO-30`) - so what this
 * suite stands in for is the other half: two independent local stores, two engines, one
 * stateful server, and the question of whether they end up agreeing.
 *
 * It is weaker than the manual check in exactly one way, and the way is worth naming: it
 * proves the *client protocol* converges, not that the real backend implements the server
 * side of it the same way `tests/support/fakeServer.ts` does. The contract is the shared
 * document both were written from, and `backend/tests/sync.*` is the other side's
 * evidence.
 */

interface Device {
  readonly database: TestDatabase;
  readonly engine: SyncEngine;
  readonly reachability: MemoryReachability;
}

/** A device whose clock is pinned, so last-write-wins has a stated winner. */
function createDevice(server: FakeSyncServer, options: { readonly online?: boolean } = {}): Device {
  const database = createTestDatabase();
  const reachability = createMemoryReachability(options.online ?? true);

  return {
    database,
    reachability,
    engine: createSyncEngine({
      database,
      api: createApiClient({ transport: server.transport }),
      reachability,
    }),
  };
}

async function migrated(device: Device): Promise<Device> {
  await migrate(device.database);
  return device;
}

function at(iso: string): () => Date {
  return () => new Date(iso);
}

async function liveExpenses(database: SqliteDatabase): Promise<
  ReadonlyArray<{
    readonly id: string;
    readonly amountMinor: number;
    readonly date: string;
    readonly note: string | null;
    readonly deletedAt: string | null;
  }>
> {
  return await database.getAllAsync(
    'SELECT id, amountMinor, date, note, deletedAt FROM expenses ORDER BY id',
    [],
  );
}

async function categoryNames(database: SqliteDatabase): Promise<readonly string[]> {
  const rows = await database.getAllAsync<{ name: string }>(
    'SELECT name FROM categories WHERE deletedAt IS NULL ORDER BY name',
    [],
  );
  return rows.map((row) => row.name);
}

describe('a device that went offline, came back, and a second device pulling', () => {
  let server: FakeSyncServer;
  let phone: Device;
  let tablet: Device;

  beforeEach(async () => {
    // Two changes per page, so the tablet's first sync has to page to see everything.
    server = createFakeSyncServer({ pageSize: 2 });
    phone = await migrated(createDevice(server, { online: false }));
    tablet = await migrated(createDevice(server, { online: true }));
  });

  afterEach(() => {
    phone.database.close();
    tablet.database.close();
  });

  it('sends everything it queued offline, and the other device ends up with the same rows', async () => {
    // --- offline: several changes, of every kind the MVP has ---
    await createCategory(
      phone.database,
      { name: 'Coffee', color: '#4f8a4f' },
      { id: categoryId(1), clock: at('2026-10-16T09:00:00.000Z') },
    );
    await createExpense(
      phone.database,
      {
        categoryId: categoryId(1),
        amountMinor: 450,
        currency: 'USD',
        date: '2026-10-16',
        note: 'flat white',
      },
      { id: expenseId(1), clock: at('2026-10-16T09:01:00.000Z') },
    );
    await createExpense(
      phone.database,
      {
        categoryId: categoryId(1),
        amountMinor: 1200,
        currency: 'USD',
        date: '2026-10-16',
        note: null,
      },
      { id: expenseId(2), clock: at('2026-10-16T09:02:00.000Z') },
    );
    await updateExpense(
      phone.database,
      expenseId(1),
      { amountMinor: 500 },
      { clock: at('2026-10-16T09:03:00.000Z') },
    );
    await deleteExpense(phone.database, expenseId(2), { clock: at('2026-10-16T09:04:00.000Z') });

    // Nothing left the device: a sync while unreachable is not attempted at all.
    const offline = await phone.engine.sync('app-open');
    expect(offline.status).toBe('skipped');
    expect(server.requests).toHaveLength(0);

    // --- back online ---
    phone.reachability.set(true);
    const drained = await phone.engine.sync('connectivity');
    expect(drained.status).toBe('completed');

    // The server holds what the user did, including the delete as a tombstone.
    expect(server.category(categoryId(1))?.name).toBe('Coffee');
    expect(server.expense(expenseId(1))?.amountMinor).toBe(500);
    expect(server.expense(expenseId(1))?.note).toBe('flat white');
    expect(server.expense(expenseId(2))?.deletedAt).not.toBeNull();

    // And the phone's outbox is empty, so nothing is left to retry.
    await expect(
      phone.database.getFirstAsync<{ queued: number }>('SELECT COUNT(*) AS queued FROM outbox', []),
    ).resolves.toEqual({ queued: 0 });

    // --- the second device, which has never seen any of this ---
    const pulled = await tablet.engine.sync('app-open');
    expect(pulled.status).toBe('completed');

    expect(await categoryNames(tablet.database)).toEqual(['Coffee']);
    // Same rows, same values, tombstone included: the delete crossed as a soft delete
    // rather than as a missing row.
    expect(await liveExpenses(tablet.database)).toEqual(await liveExpenses(phone.database));

    const deleted = (await liveExpenses(tablet.database)).find((row) => row.id === expenseId(2));
    expect(deleted?.deletedAt).not.toBeNull();
  });

  /**
   * The uncomfortable case the product decided for: last write wins, and the loser is
   * told nothing (§5.2). What matters for convergence is that the loser's *store* is
   * corrected rather than left holding a value the server rejected.
   */
  it('converges both devices on the later edit when they both edited one expense offline', async () => {
    await createCategory(
      phone.database,
      { name: 'Coffee', color: '#4f8a4f' },
      { id: categoryId(1), clock: at('2026-10-16T09:00:00.000Z') },
    );
    await createExpense(
      phone.database,
      {
        categoryId: categoryId(1),
        amountMinor: 450,
        currency: 'USD',
        date: '2026-10-16',
        note: null,
      },
      { id: expenseId(1), clock: at('2026-10-16T09:01:00.000Z') },
    );
    phone.reachability.set(true);
    await phone.engine.sync('app-open');
    await tablet.engine.sync('app-open');

    // Both edit the same row while neither can reach the server.
    phone.reachability.set(false);
    tablet.reachability.set(false);
    await updateExpense(
      tablet.database,
      expenseId(1),
      { amountMinor: 700 },
      { clock: at('2026-10-16T10:00:00.000Z') },
    );
    await updateExpense(
      phone.database,
      expenseId(1),
      { amountMinor: 900 },
      { clock: at('2026-10-16T11:00:00.000Z') },
    );

    // The phone's edit is the later one, and it reaches the server first.
    phone.reachability.set(true);
    await phone.engine.sync('connectivity');
    expect(server.expense(expenseId(1))?.amountMinor).toBe(900);

    // The tablet pushes its older edit and is told it lost.
    tablet.reachability.set(true);
    const result = await tablet.engine.sync('connectivity');
    expect(result.push?.conflicted).toBe(1);

    // Its local row was overwritten with the authoritative one, which is what makes the
    // two devices agree - a client that kept its own value would show 700 forever.
    const [tabletRow] = await liveExpenses(tablet.database);
    expect(tabletRow?.amountMinor).toBe(900);
    expect(await liveExpenses(tablet.database)).toEqual(await liveExpenses(phone.database));

    // Nothing is left queued on the loser: the conflict retired the entry.
    await expect(
      tablet.database.getFirstAsync<{ queued: number }>(
        'SELECT COUNT(*) AS queued FROM outbox',
        [],
      ),
    ).resolves.toEqual({ queued: 0 });
  });

  /**
   * A dropped response, which on a real network is indistinguishable from a lost request.
   * The retry carries the same `clientMutationId`, so the server replays its stored
   * result instead of applying the write a second time - and the amount is the one the
   * user typed once, not twice.
   */
  it('does not double-apply a write whose response never arrived', async () => {
    await createCategory(
      phone.database,
      { name: 'Coffee', color: '#4f8a4f' },
      { id: categoryId(1), clock: at('2026-10-16T09:00:00.000Z') },
    );
    phone.reachability.set(true);
    await phone.engine.sync('app-open');

    await createExpense(
      phone.database,
      {
        categoryId: categoryId(1),
        amountMinor: 450,
        currency: 'USD',
        date: '2026-10-16',
        note: null,
      },
      { id: expenseId(1), clock: at('2026-10-16T09:01:00.000Z') },
    );

    const mutationId = await phone.database.getFirstAsync<{ clientMutationId: string }>(
      'SELECT clientMutationId FROM outbox ORDER BY seq LIMIT 1',
      [],
    );

    // The server applies the push; the client never sees the answer.
    const api = createApiClient({ transport: server.transport });
    const body = {
      changes: [
        {
          entity: 'expense' as const,
          id: expenseId(1),
          updatedAt: '2026-10-16T09:01:00.000Z',
          clientMutationId: mutationId?.clientMutationId ?? '',
          fields: {
            categoryId: categoryId(1),
            amountMinor: 450,
            currency: 'USD',
            date: '2026-10-16',
            note: null,
          },
        },
      ],
    };
    await api.pushSync(body);
    const revisionAfterFirst = server.expense(expenseId(1))?.revision;

    // Now the engine drains the entry it still believes is queued.
    const retried = await phone.engine.sync('local-write');
    expect(retried.status).toBe('completed');

    const results = server.expense(expenseId(1));
    expect(results?.amountMinor).toBe(450);
    // Replayed, not re-applied: the revision did not move, so no other device sees a
    // spurious change either.
    expect(results?.revision).toBe(revisionAfterFirst);
  });
});
