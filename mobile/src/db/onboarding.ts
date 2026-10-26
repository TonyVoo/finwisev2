import { META_KEYS, deleteMeta, readMeta, writeMeta } from './meta';
import type { SqliteExecutor } from './sqlite';

/**
 * The one-time "review your categories" prompt shown after signup.
 *
 * Signup seeds the user's default categories on the server, and nothing tells them those
 * exist or that they can be changed. This is a flag, not a screen: a single `meta` row that
 * says Home should offer a way into the category editor once. Both answers clear it - the
 * point is to be asked once, not to nag - and it is not a synced record, because "I have
 * been asked on this device" is a fact about this device.
 *
 * Only a signup sets it. A login on a new device is a returning user who already knows
 * their categories, and the flag is wiped with the rest of the store when the account
 * changes (`meta.ts`).
 */

export async function markCategoryReviewPending(executor: SqliteExecutor): Promise<void> {
  await writeMeta(executor, META_KEYS.categoryReviewPending, '1');
}

export async function clearCategoryReviewPending(executor: SqliteExecutor): Promise<void> {
  await deleteMeta(executor, [META_KEYS.categoryReviewPending]);
}

export async function readCategoryReviewPending(executor: SqliteExecutor): Promise<boolean> {
  return (await readMeta(executor, META_KEYS.categoryReviewPending)) === '1';
}
