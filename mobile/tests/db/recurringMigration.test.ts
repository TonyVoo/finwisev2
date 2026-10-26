import { MIGRATIONS, migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Migration 6 rebuilds `outbox` and `sync_rejections` (SQLite cannot alter a CHECK). The
 * dangerous part is the undrained queue: a user upgrading with unsynced changes must not
 * lose any of them, nor see the queue reorder.
 */

async function atVersion5(): Promise<TestDatabase> {
  const database = createTestDatabase();
  for (const migration of MIGRATIONS.filter((m) => m.version <= 5)) {
    await database.execAsync(migration.up);
    await database.execAsync(`PRAGMA user_version = ${migration.version}`);
  }
  return database;
}

describe('migration 6 (recurring)', () => {
  let database: TestDatabase;

  afterEach(() => database.close());

  it('carries a pending queue across intact and in order, with the sequence high-water mark', async () => {
    database = await atVersion5();
    for (const [i, entity] of ['category', 'expense', 'expense'].entries()) {
      await database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt, attempts, lastError)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entity,
          `rec-${i}`,
          `{"n":${i}}`,
          `2026-10-0${i + 1}T00:00:00.000Z`,
          `mut-${i}`,
          'q',
          i,
          i === 2 ? 'boom' : null,
        ],
      );
    }
    // Drain one, so the high-water mark (3) is above the last surviving seq (3 - 1).
    await database.runAsync('DELETE FROM outbox WHERE seq = 3', []);

    await migrate(database);

    const rows = await database.getAllAsync<{
      seq: number;
      entity: string;
      recordId: string;
      fields: string;
      attempts: number;
    }>('SELECT seq, entity, recordId, fields, attempts FROM outbox ORDER BY seq', []);
    expect(rows).toEqual([
      { seq: 1, entity: 'category', recordId: 'rec-0', fields: '{"n":0}', attempts: 0 },
      { seq: 2, entity: 'expense', recordId: 'rec-1', fields: '{"n":1}', attempts: 1 },
    ]);

    // AUTOINCREMENT did not restart: the next entry sorts after everything ever queued.
    await database.runAsync(
      `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
       VALUES ('recurring', 'r', '{}', 'u', 'mut-new', 'q')`,
      [],
    );
    const next = await database.getFirstAsync<{ seq: number }>(
      "SELECT seq FROM outbox WHERE clientMutationId = 'mut-new'",
      [],
    );
    expect(next?.seq).toBe(4);
  });

  it('keeps the indexes the drain and the pending flag depend on', async () => {
    database = await atVersion5();
    await migrate(database);

    const indexes = await database.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'outbox'",
      [],
    );
    expect(indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining(['idx_outbox_entity_seq', 'idx_outbox_record']),
    );
  });

  it('keeps the clientMutationId uniqueness', async () => {
    database = await atVersion5();
    await migrate(database);
    const insert = () =>
      database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
         VALUES ('expense', 'r', '{}', 'u', 'same', 'q')`,
        [],
      );
    await insert();
    await expect(insert()).rejects.toThrow();
  });

  it('carries standing rejections across and accepts a recurring one', async () => {
    database = await atVersion5();
    await database.runAsync(
      "INSERT INTO sync_rejections VALUES ('expense', 'e1', 'unknown_category', 'gone', 't')",
      [],
    );

    await migrate(database);

    await database.runAsync(
      "INSERT INTO sync_rejections VALUES ('recurring', 'r1', 'validation_error', 'bad', 't')",
      [],
    );
    const rows = await database.getAllAsync<{ entity: string }>(
      'SELECT entity FROM sync_rejections ORDER BY entity',
      [],
    );
    expect(rows.map((r) => r.entity)).toEqual(['expense', 'recurring']);
    await expect(
      database.runAsync("INSERT INTO sync_rejections VALUES ('other', 'x', 'c', 'm', 't')", []),
    ).rejects.toThrow();
  });

  it('refuses an unknown entity in the outbox and an end before the start in a rule', async () => {
    database = await atVersion5();
    await migrate(database);

    await expect(
      database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
         VALUES ('bogus', 'r', '{}', 'u', 'm', 'q')`,
        [],
      ),
    ).rejects.toThrow();

    await expect(
      database.runAsync(
        `INSERT INTO recurring (id, categoryId, amountMinor, currency, frequency, startDate, endDate, updatedAt)
         VALUES ('r', 'c', 100, 'USD', 'weekly', '2026-10-10', '2026-10-09', 'u')`,
        [],
      ),
    ).rejects.toThrow();
    await expect(
      database.runAsync(
        `INSERT INTO recurring (id, categoryId, amountMinor, currency, frequency, startDate, updatedAt)
         VALUES ('r2', 'c', 100, 'USD', 'daily', '2026-10-10', 'u')`,
        [],
      ),
    ).rejects.toThrow();
  });

  it('is a no-op on a database already at the latest version', async () => {
    database = createTestDatabase();
    await migrate(database);
    await database.runAsync(
      `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
       VALUES ('recurring', 'r', '{}', 'u', 'm', 'q')`,
      [],
    );
    await migrate(database);
    const count = await database.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM outbox',
      [],
    );
    expect(count?.n).toBe(1);
  });
});
