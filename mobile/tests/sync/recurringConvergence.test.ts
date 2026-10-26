import { createApiClient } from '@/api/client';
import { migrate } from '@/db/migrations';
import { createCategory, createRecurring } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import { generateDueRecurring } from '@/recurring/generate';
import { createSyncEngine, type SyncEngine } from '@/sync/engine';
import { createMemoryReachability } from '@/sync/reachability';
import { createFakeSyncServer, type FakeSyncServer } from '../support/fakeServer';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import { categoryId } from '../support/seed';

/**
 * Recurring rules across two devices.
 *
 * The design bet: no device is "the" generator. Each one derives the same occurrences from
 * the same rule, offline, with ids that are a function of (rule, date). If that holds, the
 * server sees the same expense id from both and last-write-wins collapses them into one -
 * the user never sees a double rent payment.
 */

const TODAY = () => new Date('2026-10-26T10:00:00.000Z');
const RULE_ID = '0192f5a0-0000-7000-8000-000000000a01';

interface Device {
  readonly database: TestDatabase;
  readonly engine: SyncEngine;
}

async function device(server: FakeSyncServer): Promise<Device> {
  const database = createTestDatabase();
  await migrate(database);
  return {
    database,
    engine: createSyncEngine({
      database,
      api: createApiClient({ transport: server.transport }),
      reachability: createMemoryReachability(true),
      session: { getEpoch: () => 0 },
      beforeSync: () => generateDueRecurring(database, { clock: TODAY }).then(() => undefined),
    }),
  };
}

async function expenseIds(database: SqliteDatabase): Promise<readonly string[]> {
  const rows = await database.getAllAsync<{ id: string }>(
    'SELECT id FROM expenses WHERE deletedAt IS NULL ORDER BY date',
    [],
  );
  return rows.map((r) => r.id);
}

describe('recurring rules across two devices', () => {
  let server: FakeSyncServer;
  let phone: Device;
  let tablet: Device;

  beforeEach(async () => {
    server = createFakeSyncServer({ pageSize: 2 });
    phone = await device(server);
    tablet = await device(server);
  });

  afterEach(() => {
    phone.database.close();
    tablet.database.close();
  });

  it('creates each occurrence once, however many devices generate it', async () => {
    await createCategory(
      phone.database,
      { name: 'Rent', color: '#4f8a4f' },
      { id: categoryId(1), clock: TODAY },
    );
    await createRecurring(
      phone.database,
      {
        categoryId: categoryId(1),
        amountMinor: 90000,
        currency: 'USD',
        frequency: 'monthly',
        startDate: '2026-08-26',
        endDate: null,
        note: 'Rent',
      },
      { id: RULE_ID, clock: TODAY },
    );

    await phone.engine.sync('app-open');
    const phoneIds = await expenseIds(phone.database);
    expect(phoneIds).toHaveLength(3);

    // The tablet learns the rule and the category by pulling, then runs its own
    // generator before and after: it must find everything already there.
    await tablet.engine.sync('app-open');
    await tablet.engine.sync('manual');

    expect(await expenseIds(tablet.database)).toEqual(phoneIds);
    const stored = await tablet.database.getAllAsync('SELECT id FROM recurring', []);
    expect(stored).toHaveLength(1);
    expect(server.recurring(RULE_ID)).toBeDefined();
  });

  it('collapses two devices that both generated offline into one expense per date', async () => {
    // Both devices hold the rule before either generates (a pull, then go offline).
    await createCategory(
      phone.database,
      { name: 'Rent', color: '#4f8a4f' },
      { id: categoryId(1), clock: TODAY },
    );
    await createRecurring(
      phone.database,
      {
        categoryId: categoryId(1),
        amountMinor: 90000,
        currency: 'USD',
        frequency: 'monthly',
        startDate: '2026-10-26',
        endDate: null,
        note: null,
      },
      { id: RULE_ID, clock: TODAY },
    );
    // Push the rule without generating on the phone first.
    const phoneOnly = createSyncEngine({
      database: phone.database,
      api: createApiClient({ transport: server.transport }),
      reachability: createMemoryReachability(true),
      session: { getEpoch: () => 0 },
    });
    await phoneOnly.sync('app-open');

    // Tablet pulls the rule, then both generate independently, before either syncs again.
    const tabletPull = createSyncEngine({
      database: tablet.database,
      api: createApiClient({ transport: server.transport }),
      reachability: createMemoryReachability(true),
      session: { getEpoch: () => 0 },
    });
    await tabletPull.sync('app-open');
    const a = await generateDueRecurring(phone.database, { clock: TODAY });
    const b = await generateDueRecurring(tablet.database, { clock: TODAY });
    expect([a, b]).toEqual([1, 1]);

    await phone.engine.sync('manual');
    await tablet.engine.sync('manual');
    await phone.engine.sync('manual');

    const phoneIds = await expenseIds(phone.database);
    expect(phoneIds).toHaveLength(1);
    expect(await expenseIds(tablet.database)).toEqual(phoneIds);
  });
});
