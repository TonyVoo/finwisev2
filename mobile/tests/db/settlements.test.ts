import type { Settlement } from '@expense-tracker/shared';
import { migrate, LATEST_SCHEMA_VERSION } from '@/db/migrations';
import {
  createSettlement,
  deleteSettlement,
  restoreSettlement,
  updateSettlement,
} from '@/db/mutations';
import { listSettlements } from '@/db/queries';
import { createSqliteLocalStore } from '@/db/localStore';
import { applyServerRecord } from '@/sync/apply';
import { createSyncDatabase } from '../support/sync';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Recorded payments on the device (`docs/design/12-settle-up.md`): a synced entity like the
 * others, held in its own table, written through the outbox, and emptied with everything else when
 * the account's data scope changes. The server decides who may write one; the device only stores
 * and queues.
 */

const ANA = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const id = (n: number) => `0192f5a0-0000-7000-8000-5000000000${String(n).padStart(2, '0')}`;
const base = { fromUserId: BAO, toUserId: ANA, amountMinor: 4200, date: '2026-10-09' };

function serverSettlement(overrides: Partial<Settlement> & { id: string }): Settlement {
  return {
    fromUserId: BAO,
    toUserId: ANA,
    amountMinor: 4200,
    date: '2026-10-09',
    note: null,
    createdBy: BAO,
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-09T10:00:00.000Z',
    deletedAt: null,
    revision: 1,
    ...overrides,
  };
}

async function entries(database: TestDatabase): Promise<{ entity: string; fields: unknown }[]> {
  const rows = await database.getAllAsync<{ entity: string; fields: string }>(
    "SELECT entity, fields FROM outbox WHERE entity = 'settlement' ORDER BY seq",
    [],
  );
  return rows.map((row) => ({ entity: row.entity, fields: JSON.parse(row.fields) }));
}

describe('the settlements table', () => {
  it('is created by the latest migration, and the queue accepts the entity', async () => {
    const database = createTestDatabase();
    expect(await migrate(database)).toBe(LATEST_SCHEMA_VERSION);

    await database.runAsync(
      `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
       VALUES ('settlement', ?, '{}', 'now', 'm1', 'now')`,
      [id(1)],
    );
    await database.runAsync(
      `INSERT INTO sync_rejections (entity, recordId, code, message, rejectedAt)
       VALUES ('settlement', ?, 'validation_error', 'x', 'now')`,
      [id(1)],
    );

    const row = await database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox', []);
    expect(row?.n).toBe(1);
    database.close();
  });

  it('refuses an amount below one, as the server does', async () => {
    const database = await createSyncDatabase();

    await expect(
      database.runAsync(
        `INSERT INTO settlements (id, fromUserId, toUserId, amountMinor, date, updatedAt)
         VALUES (?, ?, ?, 0, '2026-10-09', 'now')`,
        [id(2), BAO, ANA],
      ),
    ).rejects.toThrow();
    database.close();
  });

  it('keeps the queue a drained device already had when it migrates', async () => {
    const database = createTestDatabase();
    await migrate(database);
    await database.runAsync(
      `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
       VALUES ('goal', ?, '{}', 'now', 'keep-me', 'now')`,
      [id(3)],
    );

    expect(await migrate(database)).toBe(LATEST_SCHEMA_VERSION);

    const row = await database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox', []);
    expect(row?.n).toBe(1);
    database.close();
  });
});

describe('settlements on the device', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createSyncDatabase();
  });
  afterEach(() => database.close());

  it('stores a pulled payment and lists it', async () => {
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'settlement',
        record: serverSettlement({ id: id(10), note: 'cash' }),
      });
    });

    expect(await listSettlements(database)).toEqual([
      {
        id: id(10),
        fromUserId: BAO,
        toUserId: ANA,
        amountMinor: 4200,
        date: '2026-10-09',
        note: 'cash',
        createdBy: BAO,
        pending: false,
      },
    ]);
  });

  it('lists newest first and leaves deleted ones out', async () => {
    await database.withExclusiveTransactionAsync(async (txn) => {
      for (const record of [
        serverSettlement({ id: id(11), date: '2026-10-01', revision: 1 }),
        serverSettlement({ id: id(12), date: '2026-10-09', revision: 2 }),
        serverSettlement({
          id: id(13),
          date: '2026-10-20',
          revision: 3,
          deletedAt: '2026-10-21T00:00:00.000Z',
        }),
      ]) {
        await applyServerRecord(txn, { entity: 'settlement', record });
      }
    });

    expect((await listSettlements(database)).map((s) => s.id)).toEqual([id(12), id(11)]);
  });

  it('records a payment locally and queues it, with the note trimmed', async () => {
    await createSettlement(database, { ...base, note: '  paid in cash ' }, { id: id(20) });

    expect(await entries(database)).toEqual([
      {
        entity: 'settlement',
        fields: { ...base, note: 'paid in cash' },
      },
    ]);
    const [row] = await listSettlements(database);
    expect(row).toMatchObject({
      id: id(20),
      amountMinor: 4200,
      note: 'paid in cash',
      pending: true,
    });
  });

  it('stores a note that is only spaces as no note', async () => {
    await createSettlement(database, { ...base, note: '   ' }, { id: id(21) });

    expect((await listSettlements(database))[0]?.note).toBeNull();
    expect((await entries(database))[0]?.fields).not.toHaveProperty('note', '   ');
  });

  it('sends no note at all when there is none', async () => {
    await createSettlement(database, base, { id: id(22) });

    expect((await entries(database))[0]?.fields).toEqual(base);
  });

  it('refuses an amount of zero before anything is written', async () => {
    await expect(
      createSettlement(database, { ...base, amountMinor: 0 }, { id: id(23) }),
    ).rejects.toThrow();

    expect(await entries(database)).toEqual([]);
    expect(await listSettlements(database)).toEqual([]);
  });

  it('refuses two payments between the same person', async () => {
    // The device does not know membership, but a payment to oneself can never be valid.
    await expect(
      createSettlement(database, { ...base, toUserId: BAO }, { id: id(24) }),
    ).rejects.toThrow();
    expect(await entries(database)).toEqual([]);
  });

  it('edits only what changed', async () => {
    await createSettlement(database, base, { id: id(30) });
    await database.runAsync('DELETE FROM outbox', []);

    await updateSettlement(database, id(30), { amountMinor: 5000 });

    const sent = await entries(database);
    expect(sent[sent.length - 1]?.fields).toMatchObject({ amountMinor: 5000 });
    expect((await listSettlements(database))[0]?.amountMinor).toBe(5000);
  });

  it('undoes a payment by deleting it, and brings it back on restore', async () => {
    await createSettlement(database, base, { id: id(31) });

    await deleteSettlement(database, id(31));
    expect(await listSettlements(database)).toEqual([]);

    await restoreSettlement(database, id(31));
    expect((await listSettlements(database)).map((s) => s.id)).toEqual([id(31)]);
  });
});

describe('when the data scope changes', () => {
  it('empties settlements with everything else', async () => {
    const database = await createSyncDatabase();
    await createSettlement(database, base, { id: id(40) });
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'settlement',
        record: serverSettlement({ id: id(41), revision: 2 }),
      });
    });

    await createSqliteLocalStore(database).clear();

    const row = await database.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM settlements',
      [],
    );
    expect(row?.n).toBe(0);
    database.close();
  });
});
