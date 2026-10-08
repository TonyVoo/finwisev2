import { CategorySyncFields, ExpenseSyncFields, SYNC_ENTITIES } from '@expense-tracker/shared';
import { ENTITY_SPECS } from '@/db/entities';
import { migrate } from '@/db/migrations';
import { createTestDatabase } from '../support/sqlite';

/**
 * These are drift tests, not behaviour tests.
 *
 * The local schema mirrors the wire contract column-for-column. That only stays true if
 * something fails when it stops being true: a field added to `CategorySyncFields` with
 * no matching local column would otherwise be accepted by the write helper, written
 * nowhere, and pushed as a field the UI cannot show.
 */
describe('entity specs', () => {
  it('covers every entity in the sync contract', () => {
    expect(Object.keys(ENTITY_SPECS).sort()).toEqual([...SYNC_ENTITIES].sort());
  });

  it.each([
    ['category', CategorySyncFields],
    ['expense', ExpenseSyncFields],
  ] as const)('lists exactly the mutable fields %s declares on the wire', (entity, schema) => {
    expect([...ENTITY_SPECS[entity].mutableColumns].sort()).toEqual(
      Object.keys(schema.shape).sort(),
    );
  });

  it.each([...SYNC_ENTITIES])('requires on create only columns %s can carry', (entity) => {
    const spec = ENTITY_SPECS[entity];
    expect(spec.mutableColumns).toEqual(expect.arrayContaining([...spec.requiredOnCreate]));
  });

  describe('against the migrated schema', () => {
    let columnsByTable: Record<string, Set<string>>;

    beforeAll(async () => {
      const database = createTestDatabase();
      await migrate(database);
      columnsByTable = {};
      for (const entity of SYNC_ENTITIES) {
        const { table } = ENTITY_SPECS[entity];
        const info = await database.getAllAsync<{ name: string }>(
          `PRAGMA table_info(${table})`,
          [],
        );
        columnsByTable[table] = new Set(info.map((column) => column.name));
      }
      database.close();
    });

    it.each([...SYNC_ENTITIES])('has a local column for every mutable field of %s', (entity) => {
      const spec = ENTITY_SPECS[entity];
      const columns = columnsByTable[spec.table]!;
      for (const column of spec.mutableColumns) {
        expect([...columns]).toContain(column);
      }
    });

    it.each([...SYNC_ENTITIES])('has a local column for every insert default of %s', (entity) => {
      const spec = ENTITY_SPECS[entity];
      const columns = columnsByTable[spec.table]!;
      for (const column of Object.keys(spec.insertDefaults)) {
        expect([...columns]).toContain(column);
      }
    });

    // The set the write helper does not supply on insert. If one of these ever became
    // NOT NULL without a default, every create would fail at runtime.
    it.each([...SYNC_ENTITIES])('leaves no unsatisfiable NOT NULL column on %s', async (entity) => {
      const spec = ENTITY_SPECS[entity];
      const database = createTestDatabase();
      await migrate(database);
      const info = await database.getAllAsync<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>(`PRAGMA table_info(${spec.table})`, []);
      database.close();

      const supplied = new Set<string>([
        'id',
        'updatedAt',
        ...spec.mutableColumns,
        ...Object.keys(spec.insertDefaults),
      ]);
      const unsatisfiable = info.filter(
        (column) =>
          column.notnull === 1 && column.dflt_value === null && !supplied.has(column.name),
      );
      expect(unsatisfiable).toEqual([]);
    });
  });
});
