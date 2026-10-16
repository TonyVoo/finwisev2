import { listPendingChanges } from '@/db/queries';
import { createExpense, deleteExpense, updateExpense } from '@/db/mutations';
import { createCategory } from '@/db/mutations';
import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';

/**
 * The read behind the sync sheet's `{n} changes waiting` list.
 *
 * One row per record rather than per outbox entry, and an operation label derived from
 * the row rather than stored - the two things a hand-built fixture would get wrong.
 */

let database: TestDatabase;

beforeEach(async () => {
  database = createTestDatabase();
  await migrate(database);
});

afterEach(() => {
  database.close();
});

describe('listPendingChanges', () => {
  it('is empty when nothing is queued', async () => {
    await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(1),
      amountMinor: 1250,
      date: '2026-10-08',
    });

    await expect(listPendingChanges(database)).resolves.toEqual([]);
  });

  it('carries the category name and amount of a queued expense', async () => {
    await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(1),
      amountMinor: 1250,
      date: '2026-10-08',
    });
    await updateExpense(database, expenseId(1), { amountMinor: 1900 });

    await expect(listPendingChanges(database)).resolves.toEqual([
      {
        entity: 'expense',
        recordId: expenseId(1),
        label: 'Groceries',
        amountMinor: 1900,
        operation: 'edited',
      },
    ]);
  });

  it('calls a row the server has never acknowledged an addition', async () => {
    await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
    await createExpense(
      database,
      {
        categoryId: categoryId(1),
        amountMinor: 320,
        currency: 'USD',
        date: '2026-10-09',
        note: null,
      },
      { id: expenseId(2) },
    );

    const [change] = await listPendingChanges(database);
    expect(change?.operation).toBe('added');
  });

  /**
   * §4 rule 4: the line still shows what was deleted, read from the tombstoned row, so
   * the list is not a column of blanks. That is why the join does not filter tombstones.
   */
  it('keeps the category and amount of a deleted expense', async () => {
    await seedCategory(database, { id: categoryId(1), name: 'Transport' });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(1),
      amountMinor: 320,
      date: '2026-10-08',
    });
    await deleteExpense(database, expenseId(1));

    await expect(listPendingChanges(database)).resolves.toEqual([
      {
        entity: 'expense',
        recordId: expenseId(1),
        label: 'Transport',
        amountMinor: 320,
        operation: 'deleted',
      },
    ]);
  });

  it('collapses several entries for one record into one line', async () => {
    await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(1),
      amountMinor: 1250,
      date: '2026-10-08',
    });
    await updateExpense(database, expenseId(1), { amountMinor: 1300 });
    await updateExpense(database, expenseId(1), { amountMinor: 1400 });

    // Three edits to one expense read as `1 pending` on the pill (§3 rule 5), so the
    // sheet's own list has to agree with it.
    await expect(listPendingChanges(database)).resolves.toHaveLength(1);
  });

  it('lists a queued category by name, with no amount', async () => {
    await createCategory(database, { name: 'Coffee', color: '#4f8a4f' }, { id: categoryId(9) });

    await expect(listPendingChanges(database)).resolves.toEqual([
      {
        entity: 'category',
        recordId: categoryId(9),
        label: 'Coffee',
        amountMinor: null,
        operation: 'added',
      },
    ]);
  });

  it('orders by when each record was first queued', async () => {
    await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(1),
      amountMinor: 1250,
      date: '2026-10-08',
    });
    await seedExpense(database, {
      id: expenseId(2),
      categoryId: categoryId(1),
      amountMinor: 400,
      date: '2026-10-08',
    });

    await updateExpense(database, expenseId(2), { amountMinor: 450 });
    await updateExpense(database, expenseId(1), { amountMinor: 1300 });
    // A later entry for an already-queued record must not move it up the list.
    await updateExpense(database, expenseId(2), { amountMinor: 500 });

    const changes = await listPendingChanges(database);
    expect(changes.map((change) => change.recordId)).toEqual([expenseId(2), expenseId(1)]);
  });
});
