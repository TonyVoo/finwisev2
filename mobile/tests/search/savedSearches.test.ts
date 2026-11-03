import {
  MAX_SAVED_SEARCHES,
  readSavedSearches,
  removeSavedSearch,
  saveSearch,
} from '@/search/savedSearches';
import { META_KEYS, writeMeta } from '@/db/meta';
import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

const view = { text: 'coffee', categoryId: null, kind: 'expense' as const, minMinor: 1000 };

describe('saved searches', () => {
  it('starts empty', async () => {
    expect(await readSavedSearches(database)).toEqual([]);
  });

  it('saves a search under a name, newest first, and reads it back', async () => {
    await saveSearch(database, 'Coffee over 10', view);
    await saveSearch(database, 'Income', { text: '', categoryId: null, kind: 'income' });

    const list = await readSavedSearches(database);
    expect(list.map((s) => s.name)).toEqual(['Income', 'Coffee over 10']);
    expect(list[1]?.search).toEqual(view);
  });

  it('replaces a view saved under the same name, ignoring case', async () => {
    await saveSearch(database, 'Coffee', view);
    await saveSearch(database, ' coffee ', { ...view, minMinor: 5000 });

    const list = await readSavedSearches(database);
    expect(list).toHaveLength(1);
    expect(list[0]?.search.minMinor).toBe(5000);
  });

  it('removes one by id', async () => {
    await saveSearch(database, 'A', view);
    await saveSearch(database, 'B', view);
    const [b] = await readSavedSearches(database);

    await removeSavedSearch(database, b!.id);

    expect((await readSavedSearches(database)).map((s) => s.name)).toEqual(['A']);
  });

  it('keeps the newest twenty', async () => {
    for (let i = 0; i < MAX_SAVED_SEARCHES + 3; i++) await saveSearch(database, `View ${i}`, view);
    const list = await readSavedSearches(database);
    expect(list).toHaveLength(MAX_SAVED_SEARCHES);
    expect(list[0]?.name).toBe(`View ${MAX_SAVED_SEARCHES + 2}`);
  });

  it('survives garbage in the store', async () => {
    await writeMeta(database, META_KEYS.savedSearches, '{not json');
    expect(await readSavedSearches(database)).toEqual([]);
    await writeMeta(database, META_KEYS.savedSearches, JSON.stringify([{ id: 1 }, 'x', null]));
    expect(await readSavedSearches(database)).toEqual([]);
  });

  it('does not save a blank name', async () => {
    await saveSearch(database, '   ', view);
    expect(await readSavedSearches(database)).toEqual([]);
  });
});
