import { META_KEYS, readMeta, writeMeta } from '../db/meta';
import type { GoalListItem } from '../db/queries';
import type { SqliteDatabase } from '../db/sqlite';

/**
 * A savings goal can count the stock portfolio towards its progress. Which goal is a setting of this device (the
 * holdings are worked out here, from trades only the person sees), so it is kept in the device's settings rather than
 * on the goal, and at most one goal takes it: the same money cannot fill two goals.
 *
 * The portfolio is in dong, so only a goal in dong can take it; for any other currency the link is ignored.
 */

export const PORTFOLIO_CURRENCY = 'VND';

export async function readLinkedGoal(database: SqliteDatabase): Promise<string | null> {
  const raw = await readMeta(database, META_KEYS.goalPortfolio);
  return raw === null || raw === '' ? null : raw;
}

export async function writeLinkedGoal(
  database: SqliteDatabase,
  goalId: string | null,
): Promise<void> {
  await writeMeta(database, META_KEYS.goalPortfolio, goalId ?? '');
}

/** The goal as the list should show it: with the portfolio's worth added if it is the linked one. */
export function withPortfolio(
  goal: GoalListItem,
  linkedId: string | null,
  worth: number,
): { readonly goal: GoalListItem; readonly includedMinor: number } {
  if (goal.id !== linkedId || goal.currency !== PORTFOLIO_CURRENCY || worth <= 0) {
    return { goal, includedMinor: 0 };
  }
  const includedMinor = Math.round(worth);
  return { goal: { ...goal, savedMinor: goal.savedMinor + includedMinor }, includedMinor };
}
