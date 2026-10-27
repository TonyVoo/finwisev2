import { defaultCategories } from '@expense-tracker/shared';
import { migrate } from '@/db/migrations';
import { META_KEYS, WIPED_META_KEYS, readMeta } from '@/db/meta';
import { listLiveCategories } from '@/db/queries';
import { renameCategories } from '@/db/mutations';
import { markCategoryRenameAnswered, readCategoryRenameAnswered } from '@/db/onboarding';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Renaming categories is an ordinary edit - the same write path, the same outbox, so it
 * reaches the server and every other device - done for several at once in one transaction.
 */

const EN = defaultCategories('en');

describe('renaming categories in a batch', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    for (const [index, seed] of EN.entries()) {
      await database.runAsync(
        `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
         VALUES (?, ?, ?, ?, '2026-10-01T00:00:00.000Z', 1)`,
        [`c${index}`, seed.name, seed.color, seed.isDefault ? 1 : 0],
      );
    }
  });
  afterEach(() => database.close());

  const outbox = () =>
    database.getAllAsync<{ entity: string; recordId: string; fields: string }>(
      'SELECT entity, recordId, fields FROM outbox ORDER BY seq',
      [],
    );

  it('renames each one and queues exactly one outbox entry per rename', async () => {
    await renameCategories(database, [
      { id: 'c1', to: 'Tạp hóa' },
      { id: 'c2', to: 'Di chuyển' },
    ]);

    const names = Object.fromEntries(
      (await listLiveCategories(database)).map((c) => [c.id, c.name]),
    );
    expect(names).toMatchObject({ c1: 'Tạp hóa', c2: 'Di chuyển', c3: 'Eating out' });

    const queue = await outbox();
    expect(queue.map((entry) => [entry.entity, entry.recordId])).toEqual([
      ['category', 'c1'],
      ['category', 'c2'],
    ]);
    // Only the name travels: the colour, budget and default flag are not this edit's to send.
    expect(queue.map((entry) => JSON.parse(entry.fields))).toEqual([
      { name: 'Tạp hóa' },
      { name: 'Di chuyển' },
    ]);
  });

  it('can rename the undeletable default, which is found by its flag and not its name', async () => {
    await renameCategories(database, [{ id: 'c0', to: 'Chưa phân loại' }]);
    const list = await listLiveCategories(database);
    expect(list.find((category) => category.isDefault)?.name).toBe('Chưa phân loại');
  });

  it('writes all of them or none, when one is refused', async () => {
    await expect(
      renameCategories(database, [
        { id: 'c1', to: 'Tạp hóa' },
        { id: 'c2', to: '   ' },
      ]),
    ).rejects.toThrow();

    const names = (await listLiveCategories(database)).map((category) => category.name);
    expect(names).toContain('Groceries');
    expect(names).not.toContain('Tạp hóa');
    expect(await outbox()).toEqual([]);
  });

  it('does nothing, and writes nothing, for an empty list', async () => {
    await renameCategories(database, []);
    expect(await outbox()).toEqual([]);
  });
});

describe('the one-time answer', () => {
  let database: TestDatabase;
  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });
  afterEach(() => database.close());

  it('starts unanswered, and stays answered once marked', async () => {
    expect(await readCategoryRenameAnswered(database)).toBe(false);
    await markCategoryRenameAnswered(database);
    expect(await readCategoryRenameAnswered(database)).toBe(true);
    expect(await readMeta(database, META_KEYS.categoryRenameAnswered)).toBe('1');
  });

  it('belongs to the account, so a different account on this device is asked afresh', () => {
    expect(WIPED_META_KEYS).toContain(META_KEYS.categoryRenameAnswered);
  });
});
