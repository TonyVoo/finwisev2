import { Category, Expense } from '@expense-tracker/shared';
import { applyLocalMutation } from '@/db/write';
import type { CategoryRow, ExpenseRow } from '@/db/entities';
import { SERVER_COLUMNS, applyServerRecord } from '@/sync/apply';
import type { TestDatabase } from '../support/sqlite';
import {
  categoryId,
  createSyncDatabase,
  expenseId,
  serverCategory,
  serverExpense,
} from '../support/sync';

/**
 * Writing a server row into the local store - the step both halves of sync end in.
 */

const CAT_1 = categoryId(1);
const EXP_1 = expenseId(1);

const AT = new Date('2026-10-15T10:00:00.000Z');
const LATER = new Date('2026-10-15T11:00:00.000Z');

let database: TestDatabase;

beforeEach(async () => {
  database = await createSyncDatabase();
});

afterEach(() => {
  database.close();
});

async function apply(change: Parameters<typeof applyServerRecord>[1]): Promise<void> {
  await database.withExclusiveTransactionAsync(async (txn) => {
    await applyServerRecord(txn, change);
  });
}

describe('the column list matches the contract', () => {
  // The same anti-drift check `tests/db/entities.test.ts` runs for the mutable columns,
  // for the ones a server row carries: a field added to `shared/` has to fail here
  // rather than be silently dropped on its way into SQLite.
  it.each([
    ['category', Category, SERVER_COLUMNS.category],
    ['expense', Expense, SERVER_COLUMNS.expense],
  ])('writes every %s field the contract declares', (_entity, schema, columns) => {
    expect([...columns].sort()).toEqual(Object.keys(schema.shape).sort());
  });
});

describe('applying a server row', () => {
  it('inserts a row this device has never seen', async () => {
    await apply({
      entity: 'category',
      record: serverCategory({ id: CAT_1, name: 'Transport', revision: 12 }),
    });

    expect(await database.getFirstAsync<CategoryRow>('SELECT * FROM categories', [])).toMatchObject(
      { id: CAT_1, name: 'Transport', revision: 12, isDefault: 0, deletedAt: null },
    );
  });

  it('overwrites every field of a row it has seen, including server-owned ones', async () => {
    await apply({ entity: 'category', record: serverCategory({ id: CAT_1, name: 'Old' }) });
    await apply({
      entity: 'category',
      record: serverCategory({
        id: CAT_1,
        name: 'New',
        color: '#112233',
        isDefault: true,
        revision: 30,
        updatedAt: LATER.toISOString(),
      }),
    });

    expect(await database.getFirstAsync<CategoryRow>('SELECT * FROM categories', [])).toMatchObject(
      { name: 'New', color: '#112233', isDefault: 1, revision: 30 },
    );
  });

  it('applies a tombstone as a soft delete, keeping the row', async () => {
    await apply({ entity: 'expense', record: serverExpense({ id: EXP_1 }) });
    await apply({
      entity: 'expense',
      record: serverExpense({ id: EXP_1, deletedAt: LATER.toISOString(), revision: 40 }),
    });

    const row = await database.getFirstAsync<ExpenseRow>('SELECT * FROM expenses', []);
    // Still present - the list queries filter on `deletedAt`, and a row that vanished
    // locally would be indistinguishable from one this device never received.
    expect(row).toMatchObject({ id: EXP_1, deletedAt: LATER.toISOString() });
  });
});

describe('unsent local edits survive the overwrite', () => {
  it('replays a queued edit that is newer than the server row', async () => {
    await applyLocalMutation(
      database,
      { entity: 'category', id: CAT_1, fields: { name: 'My newer name', color: '#4f8a4f' } },
      { clock: () => LATER },
    );

    // A pull delivers the server's older copy while the edit is still queued.
    await apply({
      entity: 'category',
      record: serverCategory({ id: CAT_1, name: 'Server name', updatedAt: AT.toISOString() }),
    });

    const row = await database.getFirstAsync<CategoryRow>('SELECT * FROM categories', []);
    // The server's revision is adopted - that part is authoritative - but the name the
    // user typed and has not yet managed to push is not thrown away in front of them.
    expect(row).toMatchObject({ name: 'My newer name', updatedAt: LATER.toISOString() });
  });

  it('does not replay a queued edit the server row already supersedes', async () => {
    await applyLocalMutation(
      database,
      { entity: 'category', id: CAT_1, fields: { name: 'My older name', color: '#4f8a4f' } },
      { clock: () => AT },
    );

    await apply({
      entity: 'category',
      record: serverCategory({ id: CAT_1, name: 'Server name', updatedAt: LATER.toISOString() }),
    });

    // That edit is going to lose last-write-wins when it is pushed, so showing it now
    // would promise the user an outcome the next round trip takes away.
    expect(await database.getFirstAsync<CategoryRow>('SELECT * FROM categories', [])).toMatchObject(
      { name: 'Server name' },
    );
  });
});
