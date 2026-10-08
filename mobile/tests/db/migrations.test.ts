import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

describe('migrate', () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('brings an empty database to the latest version', async () => {
    expect(await migrate(database)).toBe(LATEST_SCHEMA_VERSION);

    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
      [],
    );
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);
  });

  it('creates the three tables the store is built on', async () => {
    await migrate(database);

    const tables = await database.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      [],
    );
    expect(tables.map((table) => table.name)).toEqual(['categories', 'expenses', 'outbox']);
  });

  // Called on every app start, so a second run must not try to re-create the schema.
  it('is a no-op when already up to date', async () => {
    await migrate(database);
    await expect(migrate(database)).resolves.toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuses a migration whose version is not a positive integer', async () => {
    const broken = [{ version: 0, name: 'bad', up: 'SELECT 1' }];
    const spy = jest.spyOn(MIGRATIONS as unknown as unknown[], 'filter');
    spy.mockReturnValueOnce(broken);

    await expect(migrate(database)).rejects.toThrow(/positive integer/);
    spy.mockRestore();
  });

  describe('the schema it produces', () => {
    beforeEach(async () => {
      await migrate(database);
    });

    // The outbox is a FIFO queue. A plain rowid is reused after a delete, which would let
    // a newly queued mutation sort ahead of one queued before it.
    it('never reuses an outbox seq after a delete', async () => {
      const insert = `
        INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
        VALUES ('category', ?, '{}', '2026-10-08T00:00:00.000Z', ?, '2026-10-08T00:00:00.000Z')
      `;
      const first = await database.runAsync(insert, ['a', 'm1']);
      await database.runAsync('DELETE FROM outbox WHERE seq = ?', [first.lastInsertRowId]);
      const second = await database.runAsync(insert, ['b', 'm2']);

      expect(second.lastInsertRowId).toBeGreaterThan(first.lastInsertRowId);
    });

    // `clientMutationId` is the idempotency key the server dedupes on. Enqueuing it twice
    // locally would mean the second push is silently discarded server-side.
    it('rejects a duplicate clientMutationId', async () => {
      const insert = `
        INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
        VALUES ('expense', ?, '{}', '2026-10-08T00:00:00.000Z', 'duplicate', '2026-10-08T00:00:00.000Z')
      `;
      await database.runAsync(insert, ['a']);
      await expect(database.runAsync(insert, ['b'])).rejects.toThrow(/UNIQUE/i);
    });

    it('rejects an outbox entity outside the sync contract', async () => {
      await expect(
        database.runAsync(
          `INSERT INTO outbox (entity, recordId, fields, updatedAt, clientMutationId, queuedAt)
           VALUES ('user', 'a', '{}', '2026-10-08T00:00:00.000Z', 'm', '2026-10-08T00:00:00.000Z')`,
          [],
        ),
      ).rejects.toThrow(/CHECK/i);
    });
  });
});
