import {
  changedExpenseFields,
  createExpense,
  updateExpense,
  type ExpenseDraft,
} from '@/db/mutations';
import { findExpense } from '@/db/queries';
import { hasEdits } from '@/expenses/formModel';
import { applyServerRecord } from '@/sync/apply';
import { categoryId as catId, expenseId, serverExpense, createSyncDatabase } from '../support/sync';
import type { TestDatabase } from '../support/sqlite';

/**
 * Who paid, on the device (`docs/design/12-settle-up.md`). Null means "whoever added it" and is
 * what every existing expense has; a member's id is stored as the server sent it. The outbox
 * carries `paidBy` only when it is set or changed, so an ordinary expense's entry is exactly what
 * it always was.
 */

const CATEGORY = catId(1);
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const ANA = '0192f5a0-0000-7000-8000-00000000a001';
const base = { categoryId: CATEGORY, amountMinor: 500, currency: 'USD', date: '2026-10-09' };

async function outboxFields(database: TestDatabase): Promise<Record<string, unknown>[]> {
  const rows = await database.getAllAsync<{ fields: string }>(
    "SELECT fields FROM outbox WHERE entity = 'expense' ORDER BY seq",
    [],
  );
  return rows.map((row) => JSON.parse(row.fields) as Record<string, unknown>);
}

describe('paidBy, on the device', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createSyncDatabase();
  });
  afterEach(() => database.close());

  it('stores the payer a pulled row carries', async () => {
    await database.withExclusiveTransactionAsync(async (txn) => {
      await applyServerRecord(txn, {
        entity: 'expense',
        record: serverExpense({ id: expenseId(1), paidBy: BAO }),
      });
    });

    expect((await findExpense(database, expenseId(1)))?.paidBy).toBe(BAO);
  });

  it('holds no payer for an ordinary expense', async () => {
    await createExpense(database, base, { id: expenseId(2) });

    expect((await findExpense(database, expenseId(2)))?.paidBy).toBeNull();
    // The outbox entry is exactly what it was before this field existed.
    expect((await outboxFields(database))[0]).not.toHaveProperty('paidBy');
  });

  it('sends the payer when one is chosen on a new expense', async () => {
    await createExpense(database, { ...base, paidBy: BAO }, { id: expenseId(3) });

    expect((await outboxFields(database))[0]).toMatchObject({ paidBy: BAO });
    expect((await findExpense(database, expenseId(3)))?.paidBy).toBe(BAO);
  });

  it('changes and clears the payer of an existing expense', async () => {
    await createExpense(database, base, { id: expenseId(4) });
    await database.runAsync('DELETE FROM outbox', []);

    await updateExpense(database, expenseId(4), { paidBy: BAO });
    expect((await findExpense(database, expenseId(4)))?.paidBy).toBe(BAO);
    await updateExpense(database, expenseId(4), { paidBy: null });

    // Pending updates to one row merge, so the entry ends up carrying the latest value.
    const sent = await outboxFields(database);
    expect(sent[sent.length - 1]).toMatchObject({ paidBy: null });
    expect((await findExpense(database, expenseId(4)))?.paidBy).toBeNull();
  });
});

describe('what counts as a change', () => {
  const stored = (paidBy: string | null) =>
    ({
      id: expenseId(5),
      categoryId: CATEGORY,
      kind: 'expense',
      amountMinor: 500,
      currency: 'USD',
      originalAmountMinor: null,
      originalCurrency: null,
      date: '2026-10-09',
      note: null,
      private: false,
      paidBy,
      createdBy: null,
    }) as const;
  const draft = (paidBy: string | null | undefined): ExpenseDraft => ({
    categoryId: CATEGORY,
    kind: 'expense',
    amountMinor: 500,
    currency: 'USD',
    originalAmountMinor: null,
    originalCurrency: null,
    date: '2026-10-09',
    note: null,
    ...(paidBy === undefined ? {} : { paidBy }),
  });

  it.each([
    [null, undefined, false],
    [null, null, false],
    [null, BAO, true],
    [BAO, null, true],
    [BAO, BAO, false],
    [BAO, ANA, true],
    [BAO, undefined, true],
  ])('stored %s, draft %s: changed is %s', (was, now, changed) => {
    const fields = changedExpenseFields(stored(was), draft(now));
    expect('paidBy' in fields).toBe(changed);
    expect(hasEdits(draft(was), draft(now))).toBe(changed);
  });

  it('sends the new value, null included', () => {
    expect(changedExpenseFields(stored(BAO), draft(null)).paidBy).toBeNull();
    expect(changedExpenseFields(stored(null), draft(BAO)).paidBy).toBe(BAO);
  });
});
