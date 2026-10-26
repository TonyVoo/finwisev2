import type { SqliteDatabase } from '../db/sqlite';
import type { RecurringRow } from '../db/entities';
import { findFallbackCategory } from '../db/queries';
import { applyLocalMutation } from '../db/write';
import { todayCalendarDate } from '../lib/calendar';
import { type Clock, systemClock } from '../lib/clock';
import { dueOccurrences, occurrenceExpenseId } from './schedule';

/**
 * Turn due occurrences of every live rule into expenses.
 *
 * Runs on the device, offline, at launch and at the start of every sync pass - never on the
 * server (`shared/src/recurring.ts`). It is **idempotent by construction**: each occurrence
 * has a deterministic expense id (`occurrenceExpenseId`), and an occurrence whose id is
 * already in the table is skipped. That one check carries three requirements at once:
 *
 * - **Running twice creates nothing the second time**, so launch, foreground and every sync
 *   can all call it without coordinating.
 * - **A generated expense the user deleted stays deleted.** The tombstone is still a row
 *   with that id, so the occurrence is "already done" rather than regenerated.
 * - **Two devices converge.** Both derive the same id for the same occurrence, so when both
 *   create it the second push is an update of the first, not a duplicate.
 *
 * ### Generated rows lose every tie
 *
 * A generated expense is stamped with the *occurrence date* (midnight UTC) as its
 * `updatedAt`, not the moment it was generated. Last-write-wins orders on that, so any real
 * edit or delete the user makes afterwards - on either device - is newer and wins, and a
 * device that had not yet seen another device's delete cannot resurrect the row by
 * generating it late.
 *
 * ### Skipped, never fabricated
 *
 * A rule whose category is gone is filed under the live fallback category. With neither,
 * the rule is left for a later pass - an expense must point somewhere, and inventing a
 * category here would be a second place that decides what the fallback is.
 */

export interface GenerateOptions {
  readonly clock?: Clock;
}

/** One pass at a time per database: launch and a sync can both ask in the same tick. */
const running = new WeakMap<SqliteDatabase, Promise<number>>();

export function generateDueRecurring(
  database: SqliteDatabase,
  options: GenerateOptions = {},
): Promise<number> {
  const existing = running.get(database);
  if (existing !== undefined) return existing;

  const pass = run(database, options.clock ?? systemClock).finally(() => {
    running.delete(database);
  });
  running.set(database, pass);
  return pass;
}

async function run(database: SqliteDatabase, clock: Clock): Promise<number> {
  const today = todayCalendarDate(clock());

  const rules = await database.getAllAsync<RecurringRow>(
    'SELECT * FROM recurring WHERE deletedAt IS NULL ORDER BY startDate, id',
    [],
  );
  if (rules.length === 0) return 0;

  const fallback = await findFallbackCategory(database);
  const liveCategories = new Set(
    (
      await database.getAllAsync<{ id: string }>(
        'SELECT id FROM categories WHERE deletedAt IS NULL',
        [],
      )
    ).map((row) => row.id),
  );

  let created = 0;
  for (const rule of rules) {
    const categoryId = liveCategories.has(rule.categoryId) ? rule.categoryId : fallback?.id;
    if (categoryId === undefined) continue;

    for (const date of dueOccurrences(rule, today)) {
      const id = occurrenceExpenseId(rule.id, date);
      const present = await database.getFirstAsync<{ one: number }>(
        'SELECT 1 AS one FROM expenses WHERE id = ?',
        [id],
      );
      if (present !== null) continue;

      await applyLocalMutation(
        database,
        {
          entity: 'expense',
          id,
          fields: {
            categoryId,
            amountMinor: rule.amountMinor,
            currency: rule.currency,
            date,
            note: rule.note,
          },
        },
        { clock: () => new Date(`${date}T00:00:00.000Z`) },
      );
      created += 1;
    }
  }
  return created;
}
