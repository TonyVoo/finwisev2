import { applyServerRecord } from '@/sync/apply';
import { createCategory, updateCategory } from '@/db/mutations';
import { MIGRATIONS, migrate } from '@/db/migrations';
import { listLiveCategories, monthCategorySpend } from '@/db/queries';
import { monthRange } from '@/lib/calendar';
import {
  categoryId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';
import { serverCategory } from '../support/sync';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * A category's monthly budget end to end on the device: the column, the writes, the
 * outbox, the pull, and the one aggregate the Summary reads.
 */

const OCTOBER = monthRange('2026-10');
const options = { clock: () => new Date('2026-10-09T10:30:00.000Z') };

describe('category budget (local store)', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  describe('migration 5', () => {
    it('upgrades a version-4 database in place and leaves existing categories with no budget', async () => {
      const old = createTestDatabase();
      for (const migration of MIGRATIONS.filter((m) => m.version <= 4)) {
        await old.execAsync(migration.up);
      }
      await old.execAsync('PRAGMA user_version = 4');
      await old.runAsync(
        `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, revision)
         VALUES ('c1', 'Food', '#2F8044', 0, NULL, '2026-10-01T00:00:00.000Z', 0)`,
        [],
      );

      await migrate(old);

      const row = await old.getFirstAsync<{ monthlyBudgetMinor: number | null }>(
        "SELECT monthlyBudgetMinor FROM categories WHERE id = 'c1'",
        [],
      );
      expect(row?.monthlyBudgetMinor).toBeNull();
      old.close();
    });

    it('refuses a zero or negative budget at rest, the same rule as the server', async () => {
      for (const bad of [0, -5]) {
        await expect(
          database.runAsync(
            `INSERT INTO categories (id, name, color, isDefault, monthlyBudgetMinor, updatedAt, revision)
             VALUES (?, 'X', '#2F8044', 0, ?, '2026-10-01T00:00:00.000Z', 0)`,
            [`bad-${bad}`, bad],
          ),
        ).rejects.toThrow();
      }
    });
  });

  describe('writes', () => {
    it('creates a category with a budget and queues it', async () => {
      const queued = await createCategory(
        database,
        { name: 'Coffee', color: '#2F6FD0', monthlyBudgetMinor: 4000 },
        options,
      );

      const list = await listLiveCategories(database);
      expect(list.find((c) => c.id === queued.recordId)?.monthlyBudgetMinor).toBe(4000);
      const [entry] = await outboxEntries(database);
      expect(JSON.parse(entry!.fields)).toMatchObject({ name: 'Coffee', monthlyBudgetMinor: 4000 });
    });

    it('creates a category without one, and does not queue a budget field', async () => {
      await createCategory(database, { name: 'Coffee', color: '#2F6FD0' }, options);
      await createCategory(
        database,
        { name: 'Tea', color: '#8E4EC6', monthlyBudgetMinor: null },
        options,
      );

      for (const entry of await outboxEntries(database)) {
        expect(JSON.parse(entry.fields)).not.toHaveProperty('monthlyBudgetMinor');
      }
      const list = await listLiveCategories(database);
      expect(list.every((c) => c.monthlyBudgetMinor === null)).toBe(true);
    });

    it('sets, changes and clears a budget; clearing is pushed as an explicit null', async () => {
      const id = await seedCategory(database, { id: categoryId(1), name: 'Food' });

      await updateCategory(database, id, { monthlyBudgetMinor: 5000 }, options);
      await updateCategory(database, id, { monthlyBudgetMinor: 7500 }, options);
      await updateCategory(database, id, { monthlyBudgetMinor: null }, options);

      const fields = (await outboxEntries(database)).map((e) => JSON.parse(e.fields));
      expect(fields).toEqual([
        { monthlyBudgetMinor: 5000 },
        { monthlyBudgetMinor: 7500 },
        { monthlyBudgetMinor: null },
      ]);
      expect((await listLiveCategories(database))[0]?.monthlyBudgetMinor).toBeNull();
    });

    it('leaves the budget alone when an edit does not mention it', async () => {
      const id = await seedCategory(database, {
        id: categoryId(1),
        name: 'Food',
        monthlyBudgetMinor: 5000,
      });

      await updateCategory(database, id, { name: 'Groceries' }, options);

      const [category] = await listLiveCategories(database);
      expect(category).toMatchObject({ name: 'Groceries', monthlyBudgetMinor: 5000 });
      const [entry] = await outboxEntries(database);
      expect(JSON.parse(entry!.fields)).toEqual({ name: 'Groceries' });
    });
  });

  describe('pull', () => {
    it('stores a budget from the server and a later null clears it', async () => {
      const id = categoryId(1);
      await applyServerRecord(database, {
        entity: 'category',
        record: serverCategory({ id, monthlyBudgetMinor: 4000, revision: 1 }),
      });
      expect((await listLiveCategories(database))[0]?.monthlyBudgetMinor).toBe(4000);

      await applyServerRecord(database, {
        entity: 'category',
        record: serverCategory({
          id,
          monthlyBudgetMinor: null,
          revision: 2,
          updatedAt: '2026-10-02T00:00:00.000Z',
        }),
      });
      expect((await listLiveCategories(database))[0]?.monthlyBudgetMinor).toBeNull();
    });

    it('replays an unsent local budget edit over an older server row', async () => {
      const id = categoryId(1);
      await seedCategory(database, { id, name: 'Food', monthlyBudgetMinor: 1000 });
      await updateCategory(
        database,
        id,
        { monthlyBudgetMinor: 9000 },
        {
          clock: () => new Date('2026-10-20T00:00:00.000Z'),
        },
      );

      await applyServerRecord(database, {
        entity: 'category',
        record: serverCategory({
          id,
          name: 'Food',
          monthlyBudgetMinor: 2000,
          updatedAt: '2026-10-10T00:00:00.000Z',
          revision: 5,
        }),
      });

      expect((await listLiveCategories(database))[0]?.monthlyBudgetMinor).toBe(9000);
    });
  });

  describe('monthCategorySpend', () => {
    it("carries each category's own budget, and null for one without", async () => {
      const fallback = await seedFallbackCategory(database);
      const food = await seedCategory(database, {
        id: categoryId(1),
        name: 'Food',
        monthlyBudgetMinor: 4000,
      });
      const fun = await seedCategory(database, { id: categoryId(2), name: 'Fun' });
      await seedExpense(database, {
        id: '0192f5a0-0000-7000-8000-0000000000e1',
        categoryId: food,
        amountMinor: 3000,
        date: '2026-10-15',
      });
      await seedExpense(database, {
        id: '0192f5a0-0000-7000-8000-0000000000e2',
        categoryId: fun,
        amountMinor: 200,
        date: '2026-10-15',
      });
      void fallback;

      const rows = await monthCategorySpend(database, OCTOBER);
      expect(rows.find((r) => r.categoryId === food)?.monthlyBudgetMinor).toBe(4000);
      // The fallback has a budget in the next case; here Fun must not borrow anything.
      expect(rows.find((r) => r.categoryId === fun)?.monthlyBudgetMinor).toBeNull();
    });

    it("does not let a budget-less live category borrow the fallback's budget", async () => {
      await seedCategory(database, {
        id: categoryId(99),
        name: 'Uncategorized',
        isDefault: true,
        monthlyBudgetMinor: 1000,
      });
      const fun = await seedCategory(database, { id: categoryId(2), name: 'Fun' });
      await seedExpense(database, {
        id: '0192f5a0-0000-7000-8000-0000000000e1',
        categoryId: fun,
        amountMinor: 200,
        date: '2026-10-15',
      });

      const [row] = await monthCategorySpend(database, OCTOBER);
      expect(row?.monthlyBudgetMinor).toBeNull();
    });

    it("files an orphaned expense under the fallback, with the fallback's budget", async () => {
      await seedCategory(database, {
        id: categoryId(99),
        name: 'Uncategorized',
        isDefault: true,
        monthlyBudgetMinor: 1000,
      });
      await seedExpense(database, {
        id: '0192f5a0-0000-7000-8000-0000000000e1',
        categoryId: categoryId(77),
        amountMinor: 1500,
        date: '2026-10-15',
      });

      const [row] = await monthCategorySpend(database, OCTOBER);
      expect(row).toMatchObject({
        name: 'Uncategorized',
        monthlyBudgetMinor: 1000,
        totalMinor: 1500,
      });
    });
  });
});
