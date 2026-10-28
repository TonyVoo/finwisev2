import type { User } from '@expense-tracker/shared';
import type { SqliteDatabase, SqliteExecutor } from './sqlite';

/**
 * The signed-in user's own row.
 *
 * `docs/design/03-auth.md` §1.2 rule 7 and §1.3 rule 4 both say the same thing: on a
 * successful signup or login, persist the token pair **and write the `user` row**. The
 * row is not a cache of something the session already knows - the session knows only an
 * id - and two things the app renders on its first frame come from here:
 *
 * - **`currency`**, which every amount in the app is formatted with
 *   (`04-expense-list.md` §Behaviour rule 5). It is captured once at signup and cannot be
 *   changed, so there is nothing to keep in step; and because `JPY` has no minor unit, it
 *   also decides whether the amount keypad has a decimal key at all
 *   (`06-expense-form.md` §Behaviour rule 3).
 * - **`email`**, which Settings shows.
 *
 * Reading either from `GET /v1/me` on launch would make a cold start on a plane wait for
 * a request that cannot succeed, which is the opposite of what this app is for.
 *
 * The table is in `localStore.ts`'s wipe list, so a user change or a logout takes it with
 * everything else. That is deliberate and it is the same rule as the rest of the store
 * (`TVO-16`): a table holding the previous account's email that survived a user change
 * would be the same leak in a smaller place.
 */

/** A row of the local `user` table. Mirrors the contract's `User` shape. */
export interface UserRow {
  readonly id: string;
  readonly email: string;
  /** What other people see for this account, or null when none is chosen. */
  readonly displayName: string | null;
  readonly currency: string;
  readonly emailVerified: boolean;
  readonly createdAt: string;
}

export async function readUser(executor: SqliteExecutor): Promise<UserRow | null> {
  const row = await executor.getFirstAsync<
    Omit<UserRow, 'emailVerified'> & { emailVerified: number }
  >(
    'SELECT id, email, displayName, currency, emailVerified, createdAt FROM user WHERE onlyRow = 1',
    [],
  );
  return row === null ? null : { ...row, emailVerified: row.emailVerified === 1 };
}

/**
 * Write the signed-in user, replacing whoever was there.
 *
 * An upsert on `onlyRow` rather than a delete-then-insert: it is one statement, so there
 * is no window in which the table is empty and a concurrent read sees no user at all.
 */
export async function writeUser(executor: SqliteExecutor, user: User): Promise<void> {
  await executor.runAsync(
    `INSERT INTO user (onlyRow, id, email, displayName, currency, emailVerified, createdAt)
          VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (onlyRow) DO UPDATE SET
            id        = excluded.id,
            email     = excluded.email,
            displayName = excluded.displayName,
            currency  = excluded.currency,
            emailVerified = excluded.emailVerified,
            createdAt = excluded.createdAt`,
    [
      user.id,
      user.email,
      user.displayName ?? null,
      user.currency,
      user.emailVerified === true ? 1 : 0,
      user.createdAt,
    ],
  );
}

/**
 * The currency to format amounts in, or null when there is no user row yet.
 *
 * Null is a real state and not an error: it is what a signed-out app reads, and it is
 * also what a session restored from secure store reads if the row was lost. Callers
 * decide what to do about it - the screens that need a currency are all behind the auth
 * gate, so in practice they see a row.
 */
export async function readUserCurrency(database: SqliteDatabase): Promise<string | null> {
  const row = await database.getFirstAsync<{ currency: string }>(
    'SELECT currency FROM user WHERE onlyRow = 1',
    [],
  );
  return row?.currency ?? null;
}

/** The signed-in account's email, or null when there is no user row (see {@link readUserCurrency}). */
export async function readUserEmail(database: SqliteDatabase): Promise<string | null> {
  const row = await database.getFirstAsync<{ email: string }>(
    'SELECT email FROM user WHERE onlyRow = 1',
    [],
  );
  return row?.email ?? null;
}

/** The account's display name, or null when there is none (or no user row). */
export async function readUserDisplayName(database: SqliteDatabase): Promise<string | null> {
  const row = await database.getFirstAsync<{ displayName: string | null }>(
    'SELECT displayName FROM user WHERE onlyRow = 1',
    [],
  );
  return row?.displayName ?? null;
}

/** Whether the account's email is verified. False when there is no user row. */
export async function readEmailVerified(database: SqliteDatabase): Promise<boolean> {
  const row = await database.getFirstAsync<{ emailVerified: number }>(
    'SELECT emailVerified FROM user WHERE onlyRow = 1',
    [],
  );
  return row?.emailVerified === 1;
}
