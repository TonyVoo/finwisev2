import { CATEGORY_RESERVED_COLOR, categoryColor } from '@/theme/tokens';
import type { SqliteDatabase } from '@/db/sqlite';

/**
 * Rows in the state they are in **after** a successful sync: a server-assigned
 * `createdAt`, a non-zero `revision`, and no outbox entry.
 *
 * Written with direct SQL rather than through `db/mutations.ts`, and the distinction is
 * the point. A row created through the real write helper necessarily carries an outbox
 * entry, which makes it `pending` and puts the clock glyph on it - so a list fixture built
 * that way could never show a *settled* row, and a case about "which rows show the pending
 * glyph" would have nothing to contrast against. The real write path is exercised by the
 * cases that are about writing; these are the background the screen renders over.
 *
 * `amountMinor` is passed as an integer in minor units, as it is stored everywhere.
 */

/** Ids are UUIDv7-shaped because the list orders on `id` within a day. */
export function expenseId(sequence: number): string {
  return `0192f5a0-0000-7000-8000-0000000e${sequence.toString().padStart(4, '0')}`;
}

export function categoryId(sequence: number): string {
  return `0192f5a0-0000-7000-8000-0000000c${sequence.toString().padStart(4, '0')}`;
}

export interface SeededCategory {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly isDefault?: boolean;
  readonly monthlyBudgetMinor?: number | null;
}

export async function seedCategory(
  database: SqliteDatabase,
  category: SeededCategory,
): Promise<string> {
  await database.runAsync(
    `INSERT INTO categories (id, name, color, isDefault, monthlyBudgetMinor, createdAt, updatedAt, deletedAt, revision)
     VALUES (?, ?, ?, ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NULL, 1)`,
    [
      category.id,
      category.name,
      category.color ?? categoryColor.green,
      category.isDefault === true ? 1 : 0,
      category.monthlyBudgetMinor ?? null,
    ],
  );
  return category.id;
}

/** The seeded fallback, as the server creates it: `Uncategorized`, slate, `isDefault`. */
export async function seedFallbackCategory(
  database: SqliteDatabase,
  overrides: { readonly id?: string; readonly name?: string } = {},
): Promise<string> {
  return await seedCategory(database, {
    id: overrides.id ?? categoryId(99),
    name: overrides.name ?? 'Uncategorized',
    color: CATEGORY_RESERVED_COLOR,
    isDefault: true,
  });
}

export interface SeededExpense {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  /** `YYYY-MM-DD`. Stored and compared as text, never via a `Date`. */
  readonly date: string;
  readonly note?: string | null;
  readonly currency?: string;
  /** Set to tombstone the row on insert, for the soft-delete exclusion cases. */
  readonly deletedAt?: string | null;
}

export async function seedExpense(
  database: SqliteDatabase,
  expense: SeededExpense,
): Promise<string> {
  await database.runAsync(
    `INSERT INTO expenses
       (id, categoryId, amountMinor, currency, date, note,
        createdAt, updatedAt, deletedAt, revision)
     VALUES (?, ?, ?, ?, ?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', ?, 1)`,
    [
      expense.id,
      expense.categoryId,
      expense.amountMinor,
      expense.currency ?? 'USD',
      expense.date,
      expense.note ?? null,
      expense.deletedAt ?? null,
    ],
  );
  return expense.id;
}

export interface OutboxEntryRow {
  readonly entity: string;
  readonly recordId: string;
  /** The mutation's changed fields, as stored - JSON. */
  readonly fields: string;
}

/** Every outbox entry, oldest first - the queue a drain would read. */
export async function outboxEntries(database: SqliteDatabase): Promise<readonly OutboxEntryRow[]> {
  return await database.getAllAsync<OutboxEntryRow>(
    'SELECT entity, recordId, fields FROM outbox ORDER BY seq',
    [],
  );
}

/**
 * The outbox entry at `index`, or a failure naming what was missing.
 *
 * `noUncheckedIndexedAccess` is on, so indexing a row set returns `T | undefined`.
 * Asserting here rather than with `!` means a write that queued nothing fails with a
 * sentence rather than a property access on undefined - and "nothing was queued" is
 * exactly the bug these assertions exist to catch.
 */
export function entryAt(entries: readonly OutboxEntryRow[], index: number): OutboxEntryRow {
  const found = entries[index];
  if (found === undefined) {
    throw new Error(`expected an outbox entry at index ${index}, got ${entries.length}`);
  }
  return found;
}

/** The stored row, tombstone included, for asserting a delete was soft. */
export async function storedExpense(
  database: SqliteDatabase,
  id: string,
): Promise<{
  readonly amountMinor: number;
  readonly categoryId: string;
  readonly date: string;
  readonly note: string | null;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
} | null> {
  return await database.getFirstAsync(
    'SELECT amountMinor, categoryId, date, note, updatedAt, deletedAt FROM expenses WHERE id = ?',
    [id],
  );
}
