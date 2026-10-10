import {
  EmptyLocalMutationError,
  IncompleteLocalCreateError,
  applyLocalMutation,
} from '@/db/write';
import { migrate } from '@/db/migrations';
import type { CategoryRow, ExpenseRow } from '@/db/entities';
import type { SqliteExecutor } from '@/db/sqlite';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

const CATEGORY_ID = '0192f5a0-0000-7000-8000-000000000001';
const EXPENSE_ID = '0192f5a0-0000-7000-8000-000000000002';

const AT = new Date('2026-10-08T10:30:00.000Z');
const clock = () => AT;

interface OutboxRow {
  readonly seq: number;
  readonly entity: string;
  readonly recordId: string;
  readonly fields: string;
  readonly updatedAt: string;
  readonly clientMutationId: string;
  readonly queuedAt: string;
  readonly attempts: number;
}

describe('applyLocalMutation', () => {
  let database: TestDatabase;
  let mutationId = 0;

  const options = () => ({
    clock,
    newMutationId: () => `0192f5a0-0000-7000-8000-10000000000${(mutationId += 1)}`,
  });

  const outbox = () => database.getAllAsync<OutboxRow>('SELECT * FROM outbox ORDER BY seq', []);
  const categories = () =>
    database.getAllAsync<CategoryRow>('SELECT * FROM categories ORDER BY id', []);
  const expenses = () => database.getAllAsync<ExpenseRow>('SELECT * FROM expenses ORDER BY id', []);

  const createGroceries = () =>
    applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
      options(),
    );

  beforeEach(async () => {
    database = createTestDatabase();
    mutationId = 0;
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  describe('creating a row', () => {
    it('writes the row and its outbox entry together', async () => {
      const queued = await createGroceries();

      expect(queued).toMatchObject({
        entity: 'category',
        recordId: CATEGORY_ID,
        updatedAt: '2026-10-08T10:30:00.000Z',
        created: true,
      });
      expect(queued.seq).toBeGreaterThan(0);

      expect(await categories()).toEqual([
        {
          id: CATEGORY_ID,
          name: 'Groceries',
          color: '#2F8044',
          isDefault: 0,
          createdAt: null,
          updatedAt: '2026-10-08T10:30:00.000Z',
          deletedAt: null,
          revision: 0,
        },
      ]);

      expect(await outbox()).toEqual([
        {
          seq: queued.seq,
          entity: 'category',
          recordId: CATEGORY_ID,
          fields: '{"name":"Groceries","color":"#2F8044"}',
          updatedAt: '2026-10-08T10:30:00.000Z',
          clientMutationId: queued.clientMutationId,
          queuedAt: '2026-10-08T10:30:00.000Z',
          attempts: 0,
          lastError: null,
        },
      ]);
    });

    it('marks the row as never synced', async () => {
      await createGroceries();
      const [row] = await categories();
      // `revision: 0` plus a null `createdAt` is how a read tells "mine, not yet sent"
      // from "the server has this". Nothing else in the row distinguishes them.
      expect(row?.revision).toBe(0);
      expect(row?.createdAt).toBeNull();
    });

    it('stores an expense amount as an integer and the date as a calendar date', async () => {
      await applyLocalMutation(
        database,
        {
          entity: 'expense',
          id: EXPENSE_ID,
          fields: {
            categoryId: CATEGORY_ID,
            amountMinor: 1234,
            currency: 'USD',
            date: '2026-10-08',
            note: 'Lunch',
          },
        },
        options(),
      );

      expect(await expenses()).toEqual([
        {
          id: EXPENSE_ID,
          categoryId: CATEGORY_ID,
          amountMinor: 1234,
          currency: 'USD',
          date: '2026-10-08',
          note: 'Lunch',
          createdAt: null,
          updatedAt: '2026-10-08T10:30:00.000Z',
          deletedAt: null,
          revision: 0,
        },
      ]);
    });

    it('leaves nothing behind when a create is missing a required field', async () => {
      await expect(
        applyLocalMutation(
          database,
          // No `color`: valid per the wire contract (the server assigns one) but the
          // local column is NOT NULL, because a row has to render before it ever syncs.
          { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries' } },
          options(),
        ),
      ).rejects.toThrow(IncompleteLocalCreateError);

      expect(await categories()).toEqual([]);
      expect(await outbox()).toEqual([]);
    });
  });

  describe('atomicity', () => {
    // The guarantee this module exists for. If these two ever pass with a stray row or a
    // stray outbox entry, a user's expense is being saved and silently never sent.
    it('does not keep the row when queueing it fails', async () => {
      await createGroceries();
      const reusedMutationId = (await outbox())[0]!.clientMutationId;

      await expect(
        applyLocalMutation(
          database,
          {
            entity: 'expense',
            id: EXPENSE_ID,
            fields: {
              categoryId: CATEGORY_ID,
              amountMinor: 500,
              currency: 'USD',
              date: '2026-10-08',
            },
          },
          // The outbox UNIQUE on clientMutationId fires on the second write of the
          // transaction, after the expense row has already been inserted.
          { clock, newMutationId: () => reusedMutationId },
        ),
      ).rejects.toThrow(/UNIQUE/i);

      expect(await expenses()).toEqual([]);
      expect(await outbox()).toHaveLength(1);
    });

    it('does not queue the mutation when the row write fails', async () => {
      const failing = {
        ...database,
        withExclusiveTransactionAsync: (task: (txn: SqliteExecutor) => Promise<void>) =>
          database.withExclusiveTransactionAsync(async (txn) => {
            await task({
              ...txn,
              runAsync: async (source, params) => {
                if (source.includes('INSERT INTO categories')) {
                  throw new Error('disk full');
                }
                return txn.runAsync(source, params);
              },
            });
          }),
      };

      await expect(
        applyLocalMutation(
          failing,
          { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
          options(),
        ),
      ).rejects.toThrow('disk full');

      expect(await categories()).toEqual([]);
      expect(await outbox()).toEqual([]);
    });

    it('rolls the row back when the transaction fails after both writes', async () => {
      const failing = {
        ...database,
        withExclusiveTransactionAsync: (task: (txn: SqliteExecutor) => Promise<void>) =>
          database.withExclusiveTransactionAsync(async (txn) => {
            await task(txn);
            throw new Error('commit interrupted');
          }),
      };

      await expect(
        applyLocalMutation(
          failing,
          { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
          options(),
        ),
      ).rejects.toThrow('commit interrupted');

      expect(await categories()).toEqual([]);
      expect(await outbox()).toEqual([]);
    });
  });

  describe('updating a row', () => {
    it('changes only the fields it was given', async () => {
      await createGroceries();
      const queued = await applyLocalMutation(
        database,
        { entity: 'category', id: CATEGORY_ID, fields: { name: 'Food' } },
        options(),
      );

      expect(queued.created).toBe(false);
      const [row] = await categories();
      expect(row?.name).toBe('Food');
      // Untouched. A full-row write would clobber whatever a sync pull had just landed.
      expect(row?.color).toBe('#2F8044');
    });

    it('queues only the mutated fields, not the whole row', async () => {
      await createGroceries();
      await applyLocalMutation(
        database,
        { entity: 'category', id: CATEGORY_ID, fields: { name: 'Food' } },
        options(),
      );

      const entries = await outbox();
      // A push is an upsert-with-merge. Sending `color` here would overwrite a colour
      // another device changed meanwhile with the value this device happens to hold.
      expect(JSON.parse(entries[1]!.fields)).toEqual({ name: 'Food' });
    });

    it('appends a second entry rather than replacing the first', async () => {
      await createGroceries();
      await applyLocalMutation(
        database,
        { entity: 'category', id: CATEGORY_ID, fields: { name: 'Food' } },
        options(),
      );

      const entries = await outbox();
      expect(entries).toHaveLength(2);
      expect(entries[0]!.seq).toBeLessThan(entries[1]!.seq);
      // Distinct idempotency keys: these are two mutations, and a retry of one must not
      // be mistaken for the other.
      expect(entries[0]!.clientMutationId).not.toBe(entries[1]!.clientMutationId);
    });

    /**
     * `SYNC-48`. The two entries above are what the server receives as one batch, so the
     * shape is pinned here as well as the count: disjoint `fields`, a `recordId` they
     * share, and a strictly increasing `updatedAt`. That combination is what makes a
     * conflict resolve per *field* rather than per row on the server — the measured cost
     * of appending, in `backend/tests/sync.uncoalescedOutbox.test.ts`.
     *
     * Note which clock this needs. The rest of this file pins one instant, which would
     * make both entries share an `updatedAt` — the tie `SYNC-49` is about, where the
     * server drops the second entry's fields. Two real saves are milliseconds apart, so
     * this case advances the clock rather than inheriting the fixture's.
     */
    it('leaves two entries whose fields are disjoint and whose times increase', async () => {
      let tick = AT.getTime();
      const ticking = () => new Date((tick += 1000));

      await applyLocalMutation(
        database,
        {
          entity: 'expense',
          id: EXPENSE_ID,
          fields: {
            categoryId: CATEGORY_ID,
            amountMinor: 1000,
            currency: 'USD',
            date: '2026-10-08',
          },
        },
        { ...options(), clock: ticking },
      );
      await applyLocalMutation(
        database,
        { entity: 'expense', id: EXPENSE_ID, fields: { amountMinor: 1100 } },
        { ...options(), clock: ticking },
      );
      await applyLocalMutation(
        database,
        { entity: 'expense', id: EXPENSE_ID, fields: { note: 'lunch with Sam' } },
        { ...options(), clock: ticking },
      );

      const entries = await outbox();
      expect(entries).toHaveLength(3);
      expect(entries.map((entry) => entry.recordId)).toEqual([
        EXPENSE_ID,
        EXPENSE_ID,
        EXPENSE_ID,
      ]);
      // Disjoint: the second and third entries name one field each, so neither carries
      // the other's. A coalescing outbox would hold one entry naming both.
      expect(entries.slice(1).map((entry) => JSON.parse(entry.fields))).toEqual([
        { amountMinor: 1100 },
        { note: 'lunch with Sam' },
      ]);
      const times = entries.map((entry) => entry.updatedAt);
      expect([...times].sort()).toEqual(times);
      expect(new Set(times).size).toBe(3);
    });

    it('records a delete as a tombstone, not a removal', async () => {
      await createGroceries();
      await applyLocalMutation(
        database,
        {
          entity: 'category',
          id: CATEGORY_ID,
          fields: { deletedAt: '2026-10-08T11:00:00.000Z' },
        },
        options(),
      );

      const rows = await categories();
      // Still there. A hard delete cannot cross the wire - an absent row is
      // indistinguishable from one the server has never seen.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.deletedAt).toBe('2026-10-08T11:00:00.000Z');
      expect(JSON.parse((await outbox())[1]!.fields)).toEqual({
        deletedAt: '2026-10-08T11:00:00.000Z',
      });
    });

    it('records an undelete as deletedAt null', async () => {
      await createGroceries();
      await applyLocalMutation(
        database,
        { entity: 'category', id: CATEGORY_ID, fields: { deletedAt: null } },
        options(),
      );

      expect((await categories())[0]!.deletedAt).toBeNull();
      // `null` is a value here, not an absent key. COALESCE-style merging would drop it.
      expect(JSON.parse((await outbox())[1]!.fields)).toEqual({ deletedAt: null });
    });
  });

  describe('rejecting a mutation before it reaches the database', () => {
    it('rejects fields the wire contract would reject', async () => {
      await expect(
        applyLocalMutation(
          database,
          { entity: 'category', id: CATEGORY_ID, fields: { color: 'rebeccapurple' } },
          options(),
        ),
      ).rejects.toThrow();

      expect(await outbox()).toEqual([]);
    });

    it('rejects an amount that is not an integer', async () => {
      await expect(
        applyLocalMutation(
          database,
          {
            entity: 'expense',
            id: EXPENSE_ID,
            fields: {
              categoryId: CATEGORY_ID,
              amountMinor: 12.34,
              currency: 'USD',
              date: '2026-10-08',
            },
          },
          options(),
        ),
      ).rejects.toThrow();

      expect(await expenses()).toEqual([]);
      expect(await outbox()).toEqual([]);
    });

    it('rejects a timestamp where a calendar date belongs', async () => {
      await expect(
        applyLocalMutation(
          database,
          {
            entity: 'expense',
            id: EXPENSE_ID,
            fields: {
              categoryId: CATEGORY_ID,
              amountMinor: 500,
              currency: 'USD',
              date: '2026-10-08T00:00:00.000Z' as unknown as string,
            },
          },
          options(),
        ),
      ).rejects.toThrow();
    });

    it('rejects an id that is not a UUID', async () => {
      await expect(
        applyLocalMutation(
          database,
          { entity: 'category', id: 'cat-1', fields: { name: 'X', color: '#2F8044' } },
          options(),
        ),
      ).rejects.toThrow();

      expect(await outbox()).toEqual([]);
    });

    it('rejects a mutation whose only key is explicitly undefined', async () => {
      await createGroceries();

      // `{ name: undefined }` passes the contract's "fields must not be empty"
      // refinement, because the key is present. Writing it would put SQL NULL into a
      // NOT NULL column, and queueing it would push a no-op.
      await expect(
        applyLocalMutation(
          database,
          { entity: 'category', id: CATEGORY_ID, fields: { name: undefined } },
          options(),
        ),
      ).rejects.toThrow(EmptyLocalMutationError);

      expect((await categories())[0]!.name).toBe('Groceries');
      expect(await outbox()).toHaveLength(1);
    });
  });
});
