import { applyLocalMutation } from '@/db/write';
import type { CategoryRow, ExpenseRow } from '@/db/entities';
import type { SqliteDatabase, SqliteExecutor } from '@/db/sqlite';
import { readSyncCursor, writeSyncCursor } from '@/sync/cursor';
import { pullChanges } from '@/sync/pull';
import { readOutboxBatch } from '@/sync/outbox';
import type { TestDatabase } from '../support/sqlite';
import {
  categoryId,
  createFakeSyncApi,
  createSyncDatabase,
  expenseId,
  pullPage,
  serverCategory,
  serverExpense,
  type FakeSyncApi,
} from '../support/sync';

/**
 * The pull: paging, tombstones, the cursor, and the 90-day takeover.
 */

const CAT_1 = categoryId(1);
const EXP_1 = expenseId(1);

let database: TestDatabase;
let api: FakeSyncApi;

beforeEach(async () => {
  database = await createSyncDatabase();
  api = createFakeSyncApi();
});

afterEach(() => {
  database.close();
});

async function countLive(table: 'categories' | 'expenses'): Promise<number> {
  const row = await database.getFirstAsync<{ rows: number }>(
    `SELECT COUNT(*) AS rows FROM ${table} WHERE deletedAt IS NULL`,
    [],
  );
  return row?.rows ?? 0;
}

describe('paging', () => {
  it('asks from the persisted cursor and keeps asking until hasMore is false', async () => {
    await writeSyncCursor(database, 40);

    api.pullHandler = (query, call) => {
      if (call === 0) {
        expect(query?.since).toBe(40);
        return pullPage({
          changes: [{ entity: 'category', record: serverCategory({ id: CAT_1, revision: 41 }) }],
          nextCursor: 41,
          hasMore: true,
        });
      }
      expect(query?.since).toBe(41);
      return pullPage({
        changes: [{ entity: 'expense', record: serverExpense({ id: EXP_1, revision: 42 }) }],
        nextCursor: 42,
        hasMore: false,
      });
    };

    const outcome = await pullChanges({ database, api });

    expect(outcome).toMatchObject({ pages: 2, changes: 2, cursor: 42, resynced: false });
    expect(await readSyncCursor(database)).toBe(42);
    expect(await countLive('categories')).toBe(1);
    expect(await countLive('expenses')).toBe(1);
  });

  it('applies a tombstone as a local soft delete', async () => {
    api.pullHandler = () =>
      pullPage({
        changes: [
          {
            entity: 'expense',
            record: serverExpense({
              id: EXP_1,
              deletedAt: '2026-10-14T09:00:00.000Z',
              revision: 5,
            }),
          },
        ],
        nextCursor: 5,
      });

    await pullChanges({ database, api });

    const row = await database.getFirstAsync<ExpenseRow>('SELECT * FROM expenses', []);
    expect(row).toMatchObject({ id: EXP_1, deletedAt: '2026-10-14T09:00:00.000Z' });
    expect(await countLive('expenses')).toBe(0);
  });

  it('stops rather than looping when hasMore arrives with a cursor that did not advance', async () => {
    api.pullHandler = () => pullPage({ nextCursor: 0, hasMore: true });

    const outcome = await pullChanges({ database, api });

    expect(outcome.pages).toBe(1);
    expect(api.pulls).toHaveLength(1);
  });
});

describe('the cursor and the page it describes', () => {
  it('does not advance the cursor when the page fails to apply', async () => {
    await writeSyncCursor(database, 40);

    // One statement away from a working store: the insert the page needs is refused, so
    // the whole page - cursor included - has to roll back. A cursor written outside the
    // page's transaction would survive this and the rows would be skipped for good.
    const failing: SqliteDatabase = {
      ...database,
      withExclusiveTransactionAsync: (task) =>
        database.withExclusiveTransactionAsync(async (txn) => {
          const guarded: SqliteExecutor = {
            ...txn,
            runAsync: async (source, params) => {
              if (/INSERT INTO categories/.test(source)) throw new Error('disk full');
              return await txn.runAsync(source, params);
            },
          };
          await task(guarded);
        }),
    };

    api.pullHandler = () =>
      pullPage({
        changes: [{ entity: 'category', record: serverCategory({ id: CAT_1, revision: 41 }) }],
        nextCursor: 41,
      });

    await expect(pullChanges({ database: failing, api })).rejects.toThrow('disk full');

    expect(await readSyncCursor(database)).toBe(40);
    expect(await countLive('categories')).toBe(0);
  });
});

describe('resyncRequired', () => {
  it('wipes local rows and re-pulls from cursor 0', async () => {
    await writeSyncCursor(database, 900);
    await database.runAsync(
      `INSERT INTO categories (id, name, color, isDefault, updatedAt, revision)
       VALUES (?, 'Stale', '#4f8a4f', 0, '2026-01-01T00:00:00.000Z', 900)`,
      [categoryId(9)],
    );

    api.pullHandler = (query, call) => {
      if (call === 0) {
        expect(query?.since).toBe(900);
        return pullPage({ resyncRequired: true });
      }
      expect(query?.since).toBe(0);
      return pullPage({
        changes: [{ entity: 'category', record: serverCategory({ id: CAT_1, revision: 3 }) }],
        nextCursor: 3,
      });
    };

    const outcome = await pullChanges({ database, api });

    expect(outcome).toMatchObject({ resynced: true, cursor: 3, resyncDeferred: false });
    // The stale row is gone rather than merged - the point of the takeover is that an
    // incremental answer could resurrect rows deleted past the tombstone horizon.
    const rows = await database.getAllAsync<CategoryRow>('SELECT id FROM categories', []);
    expect(rows.map((row) => row.id)).toEqual([CAT_1]);
  });

  it('refuses to wipe while the outbox still holds unsent work', async () => {
    await writeSyncCursor(database, 900);
    await applyLocalMutation(database, {
      entity: 'category',
      id: CAT_1,
      fields: { name: 'Mine', color: '#4f8a4f' },
    });

    api.pullHandler = () => pullPage({ resyncRequired: true });

    const outcome = await pullChanges({ database, api });

    expect(outcome).toMatchObject({ resyncDeferred: true, resynced: false });
    // "A stale-but-intact local database is strictly better than a clean one missing the
    // user's work" (`02-offline-and-sync.md` §5.3).
    expect(await readOutboxBatch(database)).toHaveLength(1);
    expect(await countLive('categories')).toBe(1);
    expect(await readSyncCursor(database)).toBe(900);
  });

  it('gives up rather than looping when the server asks to resync from 0', async () => {
    api.pullHandler = () => pullPage({ resyncRequired: true });

    const outcome = await pullChanges({ database, api });

    expect(outcome.resynced).toBe(true);
    expect(api.pulls).toHaveLength(2);
  });

  it('reports progress so the Catching up screen can draw a bar', async () => {
    const progress: Array<{ pages: number; resyncing: boolean }> = [];
    api.pullHandler = (_query, call) =>
      call === 0
        ? pullPage({ resyncRequired: true })
        : pullPage({
            changes: [{ entity: 'category', record: serverCategory({ id: CAT_1 }) }],
            nextCursor: 1,
          });

    await pullChanges({
      database,
      api,
      onProgress: (update) => progress.push({ pages: update.pages, resyncing: update.resyncing }),
    });

    expect(progress).toEqual([
      { pages: 0, resyncing: true },
      { pages: 1, resyncing: true },
    ]);
  });
});
