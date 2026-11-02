import type { SqliteDatabase } from '../db/sqlite';

/**
 * The category a payment is likely to belong in, learned from the person's own entries: the one they filed the
 * same name under most often (ties go to the most recent). No table, no rules to maintain - correcting a
 * category on an entry is what teaches it. Null when the name has not been seen, so the form keeps its usual
 * last-used category.
 */
export async function guessCategory(
  database: SqliteDatabase,
  name: string | null,
  kind: 'expense' | 'income',
): Promise<string | null> {
  const wanted = name?.trim().toLowerCase() ?? '';
  if (wanted === '') return null;
  const row = await database.getFirstAsync<{ categoryId: string }>(
    `SELECT e.categoryId AS categoryId
       FROM expenses e JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
      WHERE e.deletedAt IS NULL AND e.kind = ? AND lower(trim(e.note)) = ?
      GROUP BY e.categoryId
      ORDER BY count(*) DESC, max(e.date) DESC
      LIMIT 1`,
    [kind, wanted],
  );
  return row?.categoryId ?? null;
}
