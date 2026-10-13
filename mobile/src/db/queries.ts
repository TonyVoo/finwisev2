import type { CategoryRow } from './entities';
import type { SqliteDatabase } from './sqlite';

/**
 * Reads the UI renders from.
 *
 * These are local and synchronous-fast, which is the whole point of the architecture:
 * no screen in the app has a network loading state for reading data
 * (`docs/design/02-offline-and-sync.md` §1). A read here cannot fail because the phone
 * is in a tunnel, so there is no error path to design for.
 *
 * Feature screens land in later tasks; this module holds the reads the scaffold needs.
 */

/** A category as a screen consumes it: the row plus its local-only sync state. */
export interface CategoryListItem {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly isDefault: boolean;
  /**
   * True while an undrained outbox entry references this row. The outbox is the single
   * source of truth for `pending` (`docs/design/02-offline-and-sync.md` §2), so it is
   * derived here rather than stored as a column that could fall out of step.
   */
  readonly pending: boolean;
}

/**
 * Live categories in the order `docs/design/07-categories.md` §1 specifies: alphabetical
 * case-insensitively, with the `isDefault` row pinned last whatever it is called.
 *
 * Both halves of that `ORDER BY` are load-bearing and neither is visible on the seeded
 * six, where `Bills` … `Uncategorized` sort the same way under every candidate ordering
 * (`CAT-15`, `CAT-16`, GAP 12):
 *
 * - `COLLATE NOCASE`, because SQLite's default BINARY collation sorts every capital
 *   before every lowercase, so a user's `rent` would land after `Transport`.
 * - `isDefault` first, because the last row is also the one with no swipe action
 *   (§4 rule 4), and a protected row in the middle of the list reads as an arbitrary
 *   exception.
 *
 * Tombstoned rows are excluded. They stay in the table because sync needs to carry the
 * delete, but the UI must never show them.
 */
export async function listLiveCategories(
  database: SqliteDatabase,
): Promise<readonly CategoryListItem[]> {
  const rows = await database.getAllAsync<CategoryRow & { pending: number }>(
    `SELECT c.id,
            c.name,
            c.color,
            c.isDefault,
            EXISTS (
              SELECT 1 FROM outbox o WHERE o.entity = 'category' AND o.recordId = c.id
            ) AS pending
       FROM categories c
      WHERE c.deletedAt IS NULL
      ORDER BY c.isDefault, c.name COLLATE NOCASE`,
    [],
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: row.isDefault === 1,
    pending: row.pending === 1,
  }));
}

/**
 * How many distinct records have undrained outbox entries.
 *
 * Distinct *records*, not entries: the sync pill reads "3 pending" as three expenses,
 * so three edits to one expense are one pending record
 * (`docs/design/02-offline-and-sync.md` §3 rule 5).
 */
export async function countPendingRecords(database: SqliteDatabase): Promise<number> {
  const row = await database.getFirstAsync<{ pending: number }>(
    'SELECT COUNT(DISTINCT entity || recordId) AS pending FROM outbox',
    [],
  );
  return row?.pending ?? 0;
}
