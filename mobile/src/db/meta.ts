import type { SqliteExecutor } from './sqlite';

/**
 * The `meta` table: one row per fact about the store itself, rather than about the
 * user's data.
 *
 * It exists because a handful of things the app has to remember are properties of the
 * *file*, not of any row in it - who the store belongs to, and how far sync has read.
 * Giving each its own table would be three tables of one row; giving each a column on
 * some existing table would attach it to data it does not describe.
 *
 * The keys are declared together here for a reason that only shows up at wipe time.
 * `localStore.ts` empties the store when a different user signs in, and a key it does
 * not know about survives that wipe. For the owner key that is harmless; for
 * {@link META_KEYS.syncCursor} it is a data-loss bug - the second user would start
 * reading the server's change feed from the first user's watermark and silently never
 * receive anything written before it. One list, consulted by the wipe, is what stops a
 * future key being forgotten the same way.
 */

export const META_KEYS = {
  /** The user id whose rows this store holds. Written by `localStore.adopt`. */
  owner: 'ownerUserId',
  /**
   * Revision watermark for `GET /v1/sync?since=`. A server-assigned per-user monotonic
   * revision, never a timestamp (`docs/PLAN.md` §4). Absent means "never pulled", which
   * is the same thing as 0.
   */
  syncCursor: 'syncCursor',
  /** When a sync last completed, ISO-8601. Drives `Last synced {relative}` in the sheet. */
  lastSyncedAt: 'lastSyncedAt',
  /**
   * Present (as `'1'`) from signup until the user answers the "review your categories"
   * prompt on Home. A fact about this device's first run, not about any row, and wiped with
   * the store so it cannot carry over to the next account to sign in here.
   */
  categoryReviewPending: 'categoryReviewPending',
  /**
   * `system`, `light` or `dark`: the theme chosen in Settings. A property of this device,
   * so deliberately absent from {@link WIPED_META_KEYS} - signing out or switching account
   * must not reset how the person likes their screen.
   */
  themePreference: 'themePreference',
  /**
   * The budget alert (`month:key`) last pushed as a notification, so the same situation is
   * announced once rather than on every launch. Wiped with the store: it describes the
   * previous account's spending.
   */
  budgetNotified: 'budgetNotified',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

/**
 * Keys a wipe must take with it: everything except the owner, which the wipe is in the
 * middle of rewriting.
 */
export const WIPED_META_KEYS: readonly MetaKey[] = [
  META_KEYS.syncCursor,
  META_KEYS.lastSyncedAt,
  META_KEYS.categoryReviewPending,
  META_KEYS.budgetNotified,
];

export async function readMeta(executor: SqliteExecutor, key: MetaKey): Promise<string | null> {
  const row = await executor.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function writeMeta(
  executor: SqliteExecutor,
  key: MetaKey,
  value: string,
): Promise<void> {
  await executor.runAsync(
    `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function deleteMeta(
  executor: SqliteExecutor,
  keys: readonly MetaKey[],
): Promise<void> {
  for (const key of keys) {
    await executor.runAsync('DELETE FROM meta WHERE key = ?', [key]);
  }
}
