import {
  OWNER_KEY,
  type LocalStore,
  createMemoryLocalStore,
  createSqliteLocalStore,
} from '@/db/localStore';
import { migrate } from '@/db/migrations';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Who the local store belongs to, and what a user change does to it.
 *
 * This is the guard against `TVO-16` — a second account on the same device reading, and
 * eventually pushing, the first account's data. The cases below are the whole rule, so a
 * change that makes one of them pass for the wrong reason is worth reading twice.
 */

const USER_A = '0192f5a0-0000-7000-8000-00000000a001';
const USER_B = '0192f5a0-0000-7000-8000-00000000b001';

const CATEGORY_ID = '0192f5a0-0000-7000-8000-0000000000c1';
const EXPENSE_ID = '0192f5a0-0000-7000-8000-0000000000e1';
const WRITTEN_AT = new Date('2026-10-09T09:00:00.000Z');

describe('createSqliteLocalStore', () => {
  let database: TestDatabase;
  let store: LocalStore;

  /** One category and one expense, each with an undrained outbox entry. */
  async function seed(): Promise<void> {
    let n = 0;
    const options = {
      clock: () => WRITTEN_AT,
      newMutationId: () => `0192f5a0-0000-7000-8000-30000000000${(n += 1)}`,
    };
    await applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
      options,
    );
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id: EXPENSE_ID,
        fields: { categoryId: CATEGORY_ID, amountMinor: 1250, currency: 'USD', date: '2026-10-09' },
      },
      options,
    );
  }

  async function rowCounts() {
    const [categories, expenses, outbox] = await Promise.all([
      database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM categories', []),
      database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expenses', []),
      database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox', []),
    ]);
    return { categories: categories!.n, expenses: expenses!.n, outbox: outbox!.n };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
    store = createSqliteLocalStore(database);
  });

  afterEach(() => {
    database.close();
  });

  it('reads as unowned on a fresh install', async () => {
    await expect(store.readOwner()).resolves.toBeNull();
  });

  describe('adopt', () => {
    it('claims an empty unowned store without deleting anything', async () => {
      await expect(store.adopt(USER_A)).resolves.toBe('claimed');
      await expect(store.readOwner()).resolves.toBe(USER_A);
    });

    /**
     * `AUTH-12`'s local half. The same user coming back — after a logout, or after the
     * forced clear that follows an expired refresh token — must find their undrained
     * writes exactly where they left them, because those writes are the only copy.
     */
    it('keeps every row when the same user adopts again', async () => {
      await store.adopt(USER_A);
      await seed();

      await expect(store.adopt(USER_A)).resolves.toBe('kept');

      expect(await rowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
    });

    /**
     * `AUTH-19`. The leak, from both ends: the rows a second account would have read, and
     * the outbox entries it would have pushed under its own bearer token.
     */
    it('wipes rows and outbox when a different user adopts', async () => {
      await store.adopt(USER_A);
      await seed();

      await expect(store.adopt(USER_B)).resolves.toBe('wiped');

      expect(await rowCounts()).toEqual({ categories: 0, expenses: 0, outbox: 0 });
      await expect(store.readOwner()).resolves.toBe(USER_B);
    });

    // Tombstoned rows are still rows, and still another account's business.
    it('wipes tombstoned rows too', async () => {
      await store.adopt(USER_A);
      await seed();
      await database.runAsync('UPDATE expenses SET deletedAt = ?', ['2026-10-09T10:00:00.000Z']);

      await store.adopt(USER_B);

      expect((await rowCounts()).expenses).toBe(0);
    });

    /**
     * The ambiguous case, resolved toward safety. A store with rows and no owner is a
     * database written before the owner was recorded, or one whose stamp was lost. Its
     * rows cannot be shown to belong to the user adopting it, so they are treated as
     * somebody else's rather than inherited.
     */
    it('wipes an unowned store that already holds rows', async () => {
      await seed();

      await expect(store.adopt(USER_A)).resolves.toBe('wiped');

      expect(await rowCounts()).toEqual({ categories: 0, expenses: 0, outbox: 0 });
      await expect(store.readOwner()).resolves.toBe(USER_A);
    });

    it('does not leave a second owner row behind on a change', async () => {
      await store.adopt(USER_A);
      await store.adopt(USER_B);

      const rows = await database.getAllAsync<{ value: string }>(
        'SELECT value FROM meta WHERE key = ?',
        [OWNER_KEY],
      );
      expect(rows).toEqual([{ value: USER_B }]);
    });

    /**
     * The wipe and the stamp are one transaction. If they were not, a crash between them
     * would leave a store that reads as owned by the new user while still holding the old
     * user's rows — the leak, with the guard against it already satisfied, which is worse
     * than no guard because nothing would ever re-check.
     */
    it('leaves the old owner and the old rows in place if the stamp fails', async () => {
      await store.adopt(USER_A);
      await seed();

      // The failure is injected into the transaction's executor, which is what the store
      // actually writes through, rather than into the database handle it never uses once
      // the transaction is open.
      const failing = createSqliteLocalStore({
        ...database,
        withExclusiveTransactionAsync: (task) =>
          database.withExclusiveTransactionAsync(async (txn) => {
            await task({
              ...txn,
              runAsync: async (source, params) => {
                if (source.includes('INSERT INTO meta')) throw new Error('disk full');
                return txn.runAsync(source, params);
              },
            });
          }),
      });

      await expect(failing.adopt(USER_B)).rejects.toThrow('disk full');

      expect(await rowCounts()).toEqual({ categories: 1, expenses: 1, outbox: 2 });
      await expect(store.readOwner()).resolves.toBe(USER_A);
    });
  });

  describe('clear', () => {
    // `04-expense-list.md` §Behaviour rule 14: logout wipes the local database.
    it('deletes every row and leaves the store unowned', async () => {
      await store.adopt(USER_A);
      await seed();

      await store.clear();

      expect(await rowCounts()).toEqual({ categories: 0, expenses: 0, outbox: 0 });
      await expect(store.readOwner()).resolves.toBeNull();
    });

    it('is safe to call on an already empty store', async () => {
      await expect(store.clear()).resolves.toBeUndefined();
      await expect(store.readOwner()).resolves.toBeNull();
    });
  });
});

/** An opened store plus whatever has to be released afterwards. */
interface Opened {
  readonly store: LocalStore;
  readonly close?: () => void;
}

/**
 * The fake re-implements the decision rather than wrapping it, which is how a fake drifts
 * from the thing it stands in for. So the decision table runs against both, and a change
 * to one that does not reach the other fails here rather than in whichever suite happens
 * to use the fake.
 */
describe.each([
  [
    'sqlite',
    async (): Promise<Opened> => {
      const database = createTestDatabase();
      await migrate(database);
      return { store: createSqliteLocalStore(database), close: () => database.close() };
    },
  ],
  ['memory', async (): Promise<Opened> => ({ store: createMemoryLocalStore() })],
])('%s store, the same decision table', (_name, open) => {
  let opened: Opened;

  beforeEach(async () => {
    opened = await open();
  });

  // The sqlite case holds a real handle; leaving it open is what makes jest force-exit a
  // worker at the end of the run.
  afterEach(() => {
    opened.close?.();
  });

  it('claims, then keeps, then wipes on a change', async () => {
    const { store } = opened;

    await expect(store.adopt(USER_A)).resolves.toBe('claimed');
    await expect(store.adopt(USER_A)).resolves.toBe('kept');
    await expect(store.adopt(USER_B)).resolves.toBe('wiped');
    await expect(store.readOwner()).resolves.toBe(USER_B);
  });

  it('claims again after a clear', async () => {
    const { store } = opened;
    await store.adopt(USER_A);

    await store.clear();

    await expect(store.readOwner()).resolves.toBeNull();
    // Nothing was left for the next sign-in to inherit, so this is a claim, not a wipe.
    await expect(store.adopt(USER_B)).resolves.toBe('claimed');
  });
});
