import { migrate } from '@/db/migrations';
import { listMonthExpenses } from '@/db/queries';
import { applyLocalMutation } from '@/db/write';
import { applyServerRecord } from '@/sync/apply';
import { categoryId, expenseId, serverCategory, serverExpense } from '../support/sync';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Who added an expense, on the device. The server assigns it (`createdBy`), a pull carries it
 * down, and the device only ever reads it: a row made locally has none until the server answers.
 */

const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const MONTH = { from: '2026-10-01', to: '2026-10-31' };

describe('the author of an expense, on the device', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'category',
        record: serverCategory({ id: categoryId(1) }),
      });
    });
  });
  afterEach(() => database.close());

  it('stores the author a pulled expense carries, and lists it', async () => {
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'expense',
        record: serverExpense({ id: expenseId(1), createdBy: BAO }),
      });
    });

    const [item] = await listMonthExpenses(database, MONTH);

    expect(item?.createdBy).toBe(BAO);
  });

  it('lists none for an expense from before authors were recorded', async () => {
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'expense',
        record: serverExpense({ id: expenseId(1), createdBy: null }),
      });
    });

    const [item] = await listMonthExpenses(database, MONTH);

    expect(item?.createdBy).toBeNull();
  });

  it('has none on an expense made on this device, until the server answers', async () => {
    await applyLocalMutation(
      database,
      {
        entity: 'expense',
        id: expenseId(2),
        fields: {
          categoryId: categoryId(1),
          amountMinor: 500,
          currency: 'USD',
          date: '2026-10-09',
        },
      },
      { clock: () => new Date('2026-10-09T09:00:00.000Z') },
    );

    const [item] = await listMonthExpenses(database, MONTH);

    expect(item?.createdBy).toBeNull();
  });

  it('keeps the author when a later pull updates the same expense', async () => {
    const apply = async (createdBy: string | null, amountMinor: number, revision: number) =>
      await database.withExclusiveTransactionAsync(async (txn) => {
        await applyServerRecord(txn, {
          entity: 'expense',
          record: serverExpense({ id: expenseId(1), createdBy, amountMinor, revision }),
        });
      });
    await apply(BAO, 1000, 1);
    await apply(BAO, 2000, 2);

    const [item] = await listMonthExpenses(database, MONTH);

    expect(item).toMatchObject({ createdBy: BAO, amountMinor: 2000 });
  });
});
