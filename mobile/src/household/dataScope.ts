import type { MeResponse } from '@expense-tracker/shared';
import { isSpaceGone } from '../api/errors';
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
  'trades',
  'categories',
] as const;

/** Empties the books and everything that describes where they were synced to; `user` and the owner stay. */
async function clearBooks(executor: SqliteExecutor): Promise<void> {
  for (const table of SCOPED_TABLES) {
    await executor.runAsync(`DELETE FROM ${table}`, []);
  }
  await deleteMeta(executor, WIPED_META_KEYS);
}

/**
 * After the server converted every amount to another currency: drop the old-currency copy so the next sync
 * pulls the converted books from scratch, and keep the account as the server now describes it. Refused
 * earlier when changes are waiting, so nothing unsent is lost. The data scope is written back, since
 * the wipe takes it and the books are still the same ones.
 */
export async function resetBooksAfterCurrencyChange(
  database: SqliteDatabase,
  user: MeResponse['user'],
): Promise<void> {
  const scope = await readMeta(database, META_KEYS.dataScope);
  await database.withExclusiveTransactionAsync(async (txn) => {
    await clearBooks(txn);
    await writeUser(txn, user);
    if (scope !== null) await writeMeta(txn, META_KEYS.dataScope, scope);
  });
}

export interface ReconcileOptions {
  /**
   * The space to move to, chosen by the person (`docs/design/13-multiple-households.md`). Without one the
   * device stays in the space it holds, falling back to the personal space if that one is gone.
   */
  readonly target?: string;
}

export async function reconcileDataScope(
  database: SqliteDatabase,
  api: Pick<ApiClient, 'getMe'>,
  options: ReconcileOptions = {},
): Promise<ScopeResult> {
  // Absent means the store has only ever held the account's own books.
  const identity = (await readMeta(database, META_KEYS.owner)) ?? undefined;
  const stored = await readMeta(database, META_KEYS.dataScope);
  // What to ask as: the person's choice, else where the device already is. A device that has never been
  // told asks as nobody, and takes the server's default (the household it is in alone, an older app's view).
  const requested = options.target ?? stored ?? undefined;

  let me;
  try {
    me = await api.getMe(requested === undefined ? undefined : { spaceId: requested });
  } catch (error) {
    // Where the device is has gone (left, removed, deleted): back to the personal space. A space the
    // person just chose that is not there is not a reason to move them anywhere.
    if (
      options.target !== undefined ||
      stored === null ||
      !isSpaceGone(error) ||
      identity === undefined
    ) {
      // Offline or refused. Nothing is changed on a guess; the next pass asks again.
      return 'skipped';
    }
    try {
      me = await api.getMe({ spaceId: identity });
    } catch {
      return 'skipped';
    }
  }

  const target = me.dataOwnerId ?? me.user.id;
  await storeMembers(database, me.household);
  await storeSpaces(database, me.spaces);
  const current = stored ?? identity ?? me.user.id;

  if (current === target) {
    if (stored === null) {
      await writeMeta(database, META_KEYS.dataScope, target);
    }
    return 'unchanged';
  }

  await database.withExclusiveTransactionAsync(async (txn) => {
    await clearBooks(txn);
    // Wiped with the rest, so it is written back from the same answer.
    await storeMembers(txn, me.household);
    await storeSpaces(txn, me.spaces);
    // The space's currency while in a household, the account's own again on leaving.
    await writeUser(txn, me.user);
    await writeMeta(txn, META_KEYS.dataScope, target);
  });
  return 'switched';
}

/** The list for the switcher: kept on every call, since a join or a leave changes it without changing the books held. */
async function storeSpaces(executor: SqliteExecutor, spaces: MeResponse['spaces']): Promise<void> {
  if (spaces === undefined) {
    await deleteMeta(executor, [META_KEYS.spaces]);
    return;
  }
  await writeMeta(executor, META_KEYS.spaces, JSON.stringify(spaces));
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
