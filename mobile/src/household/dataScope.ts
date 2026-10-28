import type { MeResponse } from '@expense-tracker/shared';
import type { ApiClient } from '../api/client';
import { META_KEYS, WIPED_META_KEYS, deleteMeta, readMeta, writeMeta } from '../db/meta';
import type { SqliteDatabase, SqliteExecutor } from '../db/sqlite';
import { writeUser } from '../db/user';

/**
 * Whose rows this device holds (`docs/design/10-households.md`).
 *
 * The server decides: `GET /v1/me` says `dataOwnerId`, which is the account's own id, or - while
 * it is in a household - the owner's. A store holding one scope's rows must never push them to,
 * or pull a revision cursor from, another scope: the cursor is a position in *that* change
 * stream, and in another it would silently skip rows. So whenever the scope differs from the one
 * the store was stamped with, the rows, the outbox and the cursor are cleared and the next sync
 * pulls the new scope from scratch.
 *
 * Separate from `localStore.adopt`, which is about who is signed in. Signing in cannot know the
 * data scope (the sign-in response does not carry it), so this runs against `GET /v1/me`, at the
 * start of every sync pass and right after the person joins or leaves a household. A device that
 * was *not* the one acting - a member the owner removed - learns of it here.
 *
 * Unsynced local changes in the old scope are discarded with it. They were made to books the
 * account no longer has, and pushing them to its own would pollute them; the screens that
 * trigger a switch refuse while changes are pending, so only a removed member's device can lose
 * any.
 */

export type ScopeResult = 'unchanged' | 'switched' | 'skipped';

/** Everything a scope switch empties. `user` is kept: it is the account, not its books. */
const SCOPED_TABLES = [
  'outbox',
  'sync_rejections',
  'receipts',
  'expenses',
  'recurring',
  'goals',
  'settlements',
  'categories',
] as const;

export async function reconcileDataScope(
  database: SqliteDatabase,
  api: Pick<ApiClient, 'getMe'>,
): Promise<ScopeResult> {
  let me;
  try {
    me = await api.getMe();
  } catch {
    // Offline or refused. Nothing is changed on a guess; the next pass asks again.
    return 'skipped';
  }

  const target = me.dataOwnerId ?? me.user.id;
  await storeMembers(database, me.household);
  // Absent means the store has only ever held the account's own books.
  const identity = (await readMeta(database, META_KEYS.owner)) ?? me.user.id;
  const current = (await readMeta(database, META_KEYS.dataScope)) ?? identity;

  if (current === target) {
    if ((await readMeta(database, META_KEYS.dataScope)) === null) {
      await writeMeta(database, META_KEYS.dataScope, target);
    }
    return 'unchanged';
  }

  await database.withExclusiveTransactionAsync(async (txn) => {
    for (const table of SCOPED_TABLES) {
      await txn.runAsync(`DELETE FROM ${table}`, []);
    }
    await deleteMeta(txn, WIPED_META_KEYS);
    // Wiped with the rest, so it is written back from the same answer.
    await storeMembers(txn, me.household);
    // The household's currency while in one, the account's own again on leaving.
    await writeUser(txn, me.user);
    await writeMeta(txn, META_KEYS.dataScope, target);
  });
  return 'switched';
}

/**
 * Who is in the household, kept for labelling rows offline. Written on every call, not only on
 * a scope change, because a member joining or leaving changes it without changing whose books
 * this device holds. Cleared for an account in none, and for a server that does not say.
 */
async function storeMembers(
  executor: SqliteExecutor,
  household: MeResponse['household'],
): Promise<void> {
  if (household === null || household === undefined) {
    await deleteMeta(executor, [META_KEYS.householdMembers]);
    return;
  }
  const members = household.members.map(({ userId, email, displayName, joinedAt }) => ({
    userId,
    email,
    displayName,
    joinedAt,
  }));
  await writeMeta(executor, META_KEYS.householdMembers, JSON.stringify(members));
}
