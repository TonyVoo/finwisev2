import { createExpense, updateExpense, changedExpenseFields } from '@/db/mutations';
import type { ExpenseDraft } from '@/db/mutations';
import { findExpense, listMonthExpenses, monthPrivateSpendMinor } from '@/db/queries';
import { monthRange } from '@/lib/calendar';
import { applyServerRecord } from '@/sync/apply';
import { categoryId as catId, expenseId, serverExpense } from '../support/sync';
import { createSyncDatabase } from '../support/sync';
import type { TestDatabase } from '../support/sqlite';

/**
 * Private expenses on the device: stored, synced, listed, and summed apart from the rest.
 * The server hides another member's private expense by sending a deleted placeholder, so the
 * device never holds one it should not see; what it holds of its own is real, and its own totals
 * include it.
 */

const OCTOBER = monthRange('2026-10');
const CATEGORY = catId(1);

describe('private expenses, on the device', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createSyncDatabase();
  });
  afterEach(() => database.close());

  const base = { categoryId: CATEGORY, amountMinor: 500, currency: 'USD', date: '2026-10-09' };

  it('stores the private flag a pulled row carries, and lists it', async () => {
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'expense',
        record: serverExpense({ id: expenseId(1), private: true }),
      });
    });

    const [item] = await listMonthExpenses(database, OCTOBER);

    expect(item?.private).toBe(true);
    expect((await findExpense(database, expenseId(1)))?.private).toBe(true);
  });

  it('lists an ordinary expense as not private', async () => {
    await createExpense(database, base, { id: expenseId(2) });

    const [item] = await listMonthExpenses(database, OCTOBER);

    expect(item?.private).toBe(false);
  });

  it('queues the flag only when it is set, so an ordinary expense syncs exactly as before', async () => {
    await createExpense(database, base, { id: expenseId(2) });
    await createExpense(database, { ...base, private: true }, { id: expenseId(3) });

    const rows = await database.getAllAsync<{ recordId: string; fields: string }>(
      'SELECT recordId, fields FROM outbox ORDER BY seq',
      [],
    );
    const fields = (id: string) =>
      JSON.parse(rows.find((row) => row.recordId === id)!.fields) as Record<string, unknown>;

    expect(fields(expenseId(2))).not.toHaveProperty('private');
    expect(fields(expenseId(3))).toMatchObject({ private: true });
  });

  it('records a later change of mind as an edit of just that field', async () => {
    await createExpense(database, base, { id: expenseId(2) });
    const stored = (await findExpense(database, expenseId(2)))!;
    const draft: ExpenseDraft = {
      categoryId: stored.categoryId,
      kind: stored.kind,
      amountMinor: stored.amountMinor,
      currency: stored.currency,
      originalAmountMinor: null,
      originalCurrency: null,
      date: stored.date,
      note: stored.note,
      private: true,
    };

    expect(changedExpenseFields(stored, draft)).toEqual({ private: true });
    await updateExpense(database, expenseId(2), { private: true });
    expect((await findExpense(database, expenseId(2)))?.private).toBe(true);
  });

  it('sums the private spend of a month, leaving out income, shared expenses and deleted ones', async () => {
    await createExpense(
      database,
      { ...base, amountMinor: 100, private: true },
      { id: expenseId(1) },
    );
    await createExpense(
      database,
      { ...base, amountMinor: 250, private: true },
      { id: expenseId(2) },
    );
    await createExpense(database, { ...base, amountMinor: 999 }, { id: expenseId(3) });
    await createExpense(
      database,
      { ...base, amountMinor: 700, kind: 'income', private: true },
      { id: expenseId(4) },
    );
    await createExpense(
      database,
      { ...base, amountMinor: 50, private: true },
      { id: expenseId(5) },
    );
    await database.runAsync(
      "UPDATE expenses SET deletedAt = '2026-10-10T00:00:00.000Z' WHERE id = ?",
      [expenseId(5)],
    );
    await createExpense(
      database,
      { ...base, amountMinor: 33, date: '2026-09-30', private: true },
      { id: expenseId(6) },
    );

    expect(await monthPrivateSpendMinor(database, OCTOBER)).toBe(350);
  });

  it('is zero for a month with nothing private', async () => {
    await createExpense(database, base, { id: expenseId(1) });

    expect(await monthPrivateSpendMinor(database, OCTOBER)).toBe(0);
  });
});
