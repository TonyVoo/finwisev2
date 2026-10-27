import { MIGRATIONS, migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Migration 10 rebuilds `outbox` and `sync_rejections` again, to allow `'goal'`. As with
 * migration 6, the dangerous part is the undrained queue: unsynced changes must survive the
 * upgrade, in order.
 */

async function atVersion9(): Promise<TestDatabase> {
  const database = createTestDatabase();
  for (const migration of MIGRATIONS.filter((m) => m.version <= 9)) {
    await database.execAsync(migration.up);
    await database.execAsync(`PRAGMA user_version = ${migration.version}`);
  }
  return database;
}

describe('migration 10 (goals)', () => {
  let database: TestDatabase;
  afterEach(() => database.close());

  it('carries a pending queue and a rejection across, then accepts goal entries', async () => {
    database = await atVersion9();
    for (const [seq, id] of [
      [1, 'a'],
      [2, 'b'],
    ] as const) {
      await database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
         VALUES ('expense', ?, '{"amountMinor":${seq}}', '2026-10-01T00:00:00.000Z', ?, '2026-10-01T00:00:00.000Z')`,
        [id, `mutation-${seq}`],
      );
    }
    await database.runAsync(
      `INSERT INTO sync_rejections (entity, recordId, code, message, rejectedAt)
       VALUES ('expense', 'a', 'validation_error', 'bad', '2026-10-01T00:00:00.000Z')`,
      [],
    );

    await migrate(database);

    const queue = await database.getAllAsync<{ seq: number; recordId: string }>(
      'SELECT seq, recordId FROM outbox ORDER BY seq',
      [],
    );
    expect(queue.map((row) => row.recordId)).toEqual(['a', 'b']);
    expect(queue.map((row) => row.seq)).toEqual([1, 2]);
    expect((await database.getAllAsync('SELECT recordId FROM sync_rejections', [])).length).toBe(1);

    // The sequence keeps counting from where it was.
    await database.runAsync(
      `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
       VALUES ('goal', 'g', '{}', '2026-10-01T00:00:00.000Z', 'mutation-3', '2026-10-01T00:00:00.000Z')`,
      [],
    );
    const last = await database.getFirstAsync<{ seq: number }>(
      "SELECT seq FROM outbox WHERE recordId = 'g'",
      [],
    );
    expect(last?.seq).toBe(3);
  });

  it('keeps the indexes and refuses an unknown entity or a non-positive target', async () => {
    database = createTestDatabase();
    await migrate(database);

    const indexes = (
      await database.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'outbox'",
        [],
      )
    ).map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_outbox_entity_seq', 'idx_outbox_record']));

    await expect(
      database.runAsync(
        `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
         VALUES ('widget', 'x', '{}', 'now', 'm', 'now')`,
        [],
      ),
    ).rejects.toThrow();
    await expect(
      database.runAsync(
        `INSERT INTO goals (id, name, targetMinor, currency, updatedAt)
         VALUES ('g1', 'Zero', 0, 'USD', 'now')`,
        [],
      ),
    ).rejects.toThrow();
  });
});
