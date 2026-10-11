import { countPendingRecords, listLiveCategories } from '@/db/queries';
import { migrate } from '@/db/migrations';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Covers `src/db/queries.ts` — the reads the UI renders from.
 *
 * These had no tests. That matters more than it looks: `listLiveCategories` claims in
 * its own doc comment to return "the order `docs/design/07-categories.md` specifies for
 * the category list", and the plan's `CAT-01` asserts that order. But `CAT-01` runs
 * against `F-FRESH`, whose six seeded names (`Bills` … `Uncategorized`) happen to sort
 * correctly under *any* of the orderings you might write. A fixture that cannot tell a
 * right answer from a wrong one is not a precondition, it is a blind spot — so the
 * ordering cases below seed names chosen to separate them.
 */

const AT = new Date('2026-10-09T10:30:00.000Z');
const clock = () => AT;

/** A row as a sync pull leaves it: server-assigned revision, no outbox entry. */
interface SeedCategory {
  readonly id: string;
  readonly name: string;
  readonly isDefault?: boolean;
  readonly deletedAt?: string;
}

const ids = {
  bills: '0192f5a0-0000-7000-8000-000000000001',
  transport: '0192f5a0-0000-7000-8000-000000000002',
  uncategorized: '0192f5a0-0000-7000-8000-000000000003',
  rent: '0192f5a0-0000-7000-8000-000000000004',
  vacation: '0192f5a0-0000-7000-8000-000000000005',
  expense: '0192f5a0-0000-7000-8000-000000000006',
} as const;

describe('queries', () => {
  let database: TestDatabase;
  let mutationId = 0;

  const options = () => ({
    clock,
    newMutationId: () => `0192f5a0-0000-7000-8000-20000000000${(mutationId += 1)}`,
  });

  /** Insert pulled rows straight through SQL: `applyLocalMutation` would queue them. */
  const pull = async (...categories: readonly SeedCategory[]): Promise<void> => {
    let revision = 1;
    for (const category of categories) {
      await database.runAsync(
        `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, deletedAt, revision)
         VALUES (?, ?, '#6B7280', ?, ?, ?, ?, ?)`,
        [
          category.id,
          category.name,
          category.isDefault === true ? 1 : 0,
          AT.toISOString(),
          AT.toISOString(),
          category.deletedAt ?? null,
          revision,
        ],
      );
      revision += 1;
    }
  };

  const names = async (): Promise<readonly string[]> =>
    (await listLiveCategories(database)).map((category) => category.name);

  beforeEach(async () => {
    database = createTestDatabase();
    mutationId = 0;
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  describe('listLiveCategories', () => {
    it('maps a pulled row to what the screen consumes', async () => {
      await pull({ id: ids.uncategorized, name: 'Uncategorized', isDefault: true });

      expect(await listLiveCategories(database)).toEqual([
        {
          id: ids.uncategorized,
          name: 'Uncategorized',
          color: '#6B7280',
          isDefault: true,
          pending: false,
        },
      ]);
    });

    it('hides a tombstoned category without removing its row', async () => {
      await pull(
        { id: ids.bills, name: 'Bills' },
        { id: ids.transport, name: 'Transport', deletedAt: AT.toISOString() },
      );

      expect(await names()).toEqual(['Bills']);

      // Still in the table: sync has to carry the delete to the server.
      const remaining = await database.getAllAsync<{ id: string }>('SELECT id FROM categories', []);
      expect(remaining).toHaveLength(2);
    });

    // `CAT-17`. `pending` is derived from the outbox per read, never stored as a column
    // that could fall out of step with it.
    it('marks a row pending while an undrained outbox entry references it', async () => {
      await applyLocalMutation(
        database,
        { entity: 'category', id: ids.vacation, fields: { name: 'Vacation', color: '#2F8044' } },
        options(),
      );

      expect(await listLiveCategories(database)).toMatchObject([
        { name: 'Vacation', pending: true },
      ]);

      await database.runAsync('DELETE FROM outbox', []);

      expect(await listLiveCategories(database)).toMatchObject([
        { name: 'Vacation', pending: false },
      ]);
    });

    // `CAT-17`, continued: an expense's outbox entry names its category in `fields`, not in
    // `recordId`, so a clock glyph must not appear on a category the user never touched.
    it('does not mark a category pending because an expense is pending', async () => {
      await pull({ id: ids.bills, name: 'Bills' });
      await applyLocalMutation(
        database,
        {
          entity: 'expense',
          id: ids.expense,
          fields: { categoryId: ids.bills, amountMinor: 1200, currency: 'USD', date: '2026-10-09' },
        },
        options(),
      );

      // The outbox entry carries this category's id in `fields`, not in `recordId`, and
      // `pending` is about the row the user edited.
      expect(await listLiveCategories(database)).toMatchObject([{ name: 'Bills', pending: false }]);
    });

    /**
     * `CAT-15` [GAP 12] `ORDER BY c.name` uses SQLite's default BINARY collation, so every
     * capital letter sorts before every lowercase one. A user whose categories are
     * `Bills`, `rent`, `Transport` sees `rent` after `Transport`.
     *
     * Invisible against `F-FRESH`: all six seeded names are capitalised.
     */
    it.failing('orders case-insensitively, as the design specifies', async () => {
      await pull(
        { id: ids.bills, name: 'Bills' },
        { id: ids.rent, name: 'rent' },
        { id: ids.transport, name: 'Transport' },
      );

      expect(await names()).toEqual(['Bills', 'rent', 'Transport']);
    });

    /**
     * `CAT-16` [GAP 12] The query does not pin the `isDefault` row last
     * (`docs/design/07-categories.md` §1 state `default`). `Uncategorized` sorts last
     * among the six seeded names by accident, which is why nothing has noticed; the
     * first category a user adds that sorts after it exposes the order.
     */
    it.failing('pins the default category last regardless of its name', async () => {
      await pull(
        { id: ids.bills, name: 'Bills' },
        { id: ids.uncategorized, name: 'Uncategorized', isDefault: true },
        { id: ids.vacation, name: 'Vacation' },
      );

      expect(await names()).toEqual(['Bills', 'Vacation', 'Uncategorized']);
    });
  });

  describe('countPendingRecords', () => {
    it('is zero on an empty outbox', async () => {
      await pull({ id: ids.bills, name: 'Bills' });

      expect(await countPendingRecords(database)).toBe(0);
    });

    // `CAT-17` and `SYNC-04`'s unit half: distinct *records*, so three edits of one row is 1.
    it('counts one record per row, not one per edit', async () => {
      await applyLocalMutation(
        database,
        { entity: 'category', id: ids.vacation, fields: { name: 'Vacation', color: '#2F8044' } },
        options(),
      );
      await applyLocalMutation(
        database,
        { entity: 'category', id: ids.vacation, fields: { name: 'Holiday' } },
        options(),
      );
      await applyLocalMutation(
        database,
        { entity: 'category', id: ids.vacation, fields: { color: '#2F6FD0' } },
        options(),
      );

      // Three outbox entries, one pending record: the sync pill reads "1 pending".
      const entries = await database.getAllAsync<{ seq: number }>('SELECT seq FROM outbox', []);
      expect(entries).toHaveLength(3);
      expect(await countPendingRecords(database)).toBe(1);
    });

    it('counts a category and an expense as two records', async () => {
      await applyLocalMutation(
        database,
        { entity: 'category', id: ids.vacation, fields: { name: 'Vacation', color: '#2F8044' } },
        options(),
      );
      await applyLocalMutation(
        database,
        {
          entity: 'expense',
          id: ids.expense,
          fields: {
            categoryId: ids.vacation,
            amountMinor: 1200,
            currency: 'USD',
            date: '2026-10-09',
          },
        },
        options(),
      );

      expect(await countPendingRecords(database)).toBe(2);
    });

    // `CAT-17`, continued: an undelivered delete is itself the pending thing.
    it('still counts a record whose row is tombstoned', async () => {
      await pull({ id: ids.bills, name: 'Bills' });
      await applyLocalMutation(
        database,
        { entity: 'category', id: ids.bills, fields: { deletedAt: AT.toISOString() } },
        options(),
      );

      // The delete is the thing that has not reached the server yet, so it is pending
      // even though the row no longer appears in any list.
      expect(await names()).toEqual([]);
      expect(await countPendingRecords(database)).toBe(1);
    });
  });
});
