import type { AuthResponse, User } from '@expense-tracker/shared';
import { type SessionController, createSessionController } from '@/auth/session';
import { createMemoryTokenStore } from '@/auth/sessionRecord';
import { createMemoryLocalStore, createSqliteLocalStore } from '@/db/localStore';
import { migrate } from '@/db/migrations';
import { readUser, readUserCurrency, writeUser } from '@/db/user';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * The signed-in user's own row - `docs/design/03-auth.md` §1.2 rule 7 and §1.3 rule 4.
 *
 * Two things make this worth its own suite rather than being a line in the session tests:
 *
 * - **It is what makes a cold start work offline.** `currency` formats every amount in
 *   the app and decides whether the keypad has a decimal key; `email` is what Settings
 *   shows. Reading either from `GET /v1/me` on launch would make a launch on a plane wait
 *   for a request that cannot succeed.
 * - **It is in the wipe list.** A table holding one account's email that survived a user
 *   change would be `TVO-16` again in a smaller place, so the last block asserts the row
 *   goes on a user change and on a logout.
 */

const USER_A: User = {
  id: '0192f5a0-0000-7000-8000-00000000a001',
  email: 'ada@example.com',
  displayName: null,
  currency: 'USD',
  emailVerified: false,
  createdAt: '2026-10-08T10:00:00.000Z',
};

const USER_B: User = {
  id: '0192f5a0-0000-7000-8000-00000000b001',
  email: 'grace@example.com',
  displayName: null,
  currency: 'JPY',
  emailVerified: false,
  createdAt: '2026-10-09T11:00:00.000Z',
};

describe('the user row', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  it('reads back nothing before anyone has signed in', async () => {
    await expect(readUser(database)).resolves.toBeNull();
    // Null is a state, not a failure: it is what a signed-out app reads.
    await expect(readUserCurrency(database)).resolves.toBeNull();
  });

  it('round-trips the user the server returned', async () => {
    await writeUser(database, USER_A);

    await expect(readUser(database)).resolves.toEqual(USER_A);
  });

  it('exposes the currency every amount is formatted with', async () => {
    await writeUser(database, USER_B);

    // `JPY` is the case that matters: it has no minor unit, so this value decides whether
    // the amount keypad offers a decimal key at all (`06-expense-form.md` rule 3).
    await expect(readUserCurrency(database)).resolves.toBe('JPY');
  });

  it('replaces the previous user rather than accumulating rows', async () => {
    await writeUser(database, USER_A);
    await writeUser(database, USER_B);

    const rows = await database.getAllAsync<{ id: string }>('SELECT id FROM user', []);
    expect(rows).toHaveLength(1);
    await expect(readUser(database)).resolves.toEqual(USER_B);
  });

  it('cannot hold two users even if a caller tries', async () => {
    // "At most one user" is a schema invariant, not a convention a future caller has to
    // remember: the `onlyRow` primary key plus its CHECK make the second insert fail.
    await writeUser(database, USER_A);

    await expect(
      database.runAsync(
        'INSERT INTO user (onlyRow, id, email, currency, createdAt) VALUES (2, ?, ?, ?, ?)',
        [USER_B.id, USER_B.email, USER_B.currency, USER_B.createdAt],
      ),
    ).rejects.toThrow();
  });

  it('takes a changed email on a later login by the same user', async () => {
    await writeUser(database, USER_A);
    await writeUser(database, { ...USER_A, email: 'ada.lovelace@example.com' });

    await expect(readUser(database)).resolves.toMatchObject({
      id: USER_A.id,
      email: 'ada.lovelace@example.com',
    });
  });
});

describe('adoption writes the profile in the same transaction as the wipe', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  it('claims an empty store and writes the profile at once', async () => {
    const store = createSqliteLocalStore(database);

    await expect(store.adopt(USER_A.id, USER_A)).resolves.toBe('claimed');

    // One transaction: there is no instant at which the store is adopted but the first
    // screen behind the gate has no currency to format amounts with (§1.2 rule 7).
    await expect(store.readOwner()).resolves.toBe(USER_A.id);
    await expect(readUser(database)).resolves.toEqual(USER_A);
  });

  it('wipes the previous account profile when a different user signs in', async () => {
    const store = createSqliteLocalStore(database);
    await store.adopt(USER_A.id, USER_A);

    await expect(store.adopt(USER_B.id, USER_B)).resolves.toBe('wiped');

    // Not merely overwritten - the wipe ran, and the row that came back is the new user's.
    await expect(readUser(database)).resolves.toEqual(USER_B);
  });

  it('treats an unowned store that holds only a profile as somebody else data', async () => {
    // The conservative branch. A profile with no owner stamp cannot be shown to belong to
    // the user signing in, and the cost of guessing wrong is showing them another
    // account's email.
    await writeUser(database, USER_A);

    await expect(createSqliteLocalStore(database).adopt(USER_B.id)).resolves.toBe('wiped');
    await expect(readUser(database)).resolves.toBeNull();
  });

  it('keeps the profile when the same user signs in again', async () => {
    const store = createSqliteLocalStore(database);
    await store.adopt(USER_A.id, USER_A);

    await expect(store.adopt(USER_A.id, USER_A)).resolves.toBe('kept');

    await expect(readUser(database)).resolves.toEqual(USER_A);
  });

  it('leaves the profile alone on a cold start, which knows only the id', async () => {
    // `initialize()` re-adopts from secure store, which holds no email and no currency.
    // Passing no profile must not blank the row it is about to read.
    const store = createSqliteLocalStore(database);
    await store.adopt(USER_A.id, USER_A);

    await store.adopt(USER_A.id);

    await expect(readUser(database)).resolves.toEqual(USER_A);
  });

  it('drops the profile on an explicit logout', async () => {
    const store = createSqliteLocalStore(database);
    await store.adopt(USER_A.id, USER_A);

    await store.clear();

    // The next user on the device cannot read the previous one's email.
    await expect(readUser(database)).resolves.toBeNull();
    await expect(store.readOwner()).resolves.toBeNull();
  });
});

describe('the in-memory store stands in faithfully', () => {
  it('holds the profile it adopted', async () => {
    const store = createMemoryLocalStore();

    await store.adopt(USER_A.id, USER_A);

    expect(store.readProfile()).toEqual(USER_A);
  });

  it('wipes it on a user change', async () => {
    const store = createMemoryLocalStore();
    await store.adopt(USER_A.id, USER_A);

    await expect(store.adopt(USER_B.id, USER_B)).resolves.toBe('wiped');

    expect(store.readProfile()).toEqual(USER_B);
  });

  it('drops it on a logout', async () => {
    const store = createMemoryLocalStore();
    await store.adopt(USER_A.id, USER_A);

    await store.clear();

    expect(store.readProfile()).toBeNull();
  });

  it('treats a stored profile with no owner as somebody else data, as SQLite does', async () => {
    const store = createMemoryLocalStore({ owner: null, profile: USER_A });

    await expect(store.adopt(USER_B.id)).resolves.toBe('wiped');

    expect(store.readProfile()).toBeNull();
  });
});

/**
 * The same rules reached the way the app reaches them: through the session controller,
 * which is what signup and login actually call.
 */
describe('through the session controller', () => {
  let database: TestDatabase;

  function controllerFor(): SessionController {
    return createSessionController({
      tokenStore: createMemoryTokenStore(null),
      localStore: createSqliteLocalStore(database),
      refreshTokens: async () => {
        throw new Error('not expected in these cases');
      },
      clock: () => new Date('2026-10-13T09:00:00.000Z'),
    });
  }

  function authResponse(user: User): AuthResponse {
    return {
      user,
      accessToken: `access-${user.id}`,
      refreshToken: `refresh-${user.id}`,
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresAt: '2026-12-12T09:00:00.000Z',
    };
  }

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  it('writes the profile before it publishes an authenticated session', async () => {
    // The ordering is the point, so it is recorded rather than inferred. Publishing
    // `authenticated` is what lets the route guards mount the tab bar, and those screens
    // read SQLite on their first frame - a profile written after this point is a first
    // frame rendered with no currency to format amounts with.
    const order: string[] = [];
    const sqlite = createSqliteLocalStore(database);

    const controller = createSessionController({
      tokenStore: createMemoryTokenStore(null),
      localStore: {
        ...sqlite,
        adopt: async (userId, profile) => {
          order.push(profile === undefined ? 'adopt' : 'adopt+profile');
          return sqlite.adopt(userId, profile);
        },
      },
      refreshTokens: async () => {
        throw new Error('not expected in these cases');
      },
      clock: () => new Date('2026-10-13T09:00:00.000Z'),
    });

    await controller.initialize();
    order.length = 0;
    controller.subscribe(() => order.push(`publish:${controller.getSnapshot().status}`));

    await controller.signIn(authResponse(USER_A));

    expect(order).toEqual(['adopt+profile', 'publish:authenticated']);
    await expect(readUser(database)).resolves.toEqual(USER_A);
  });

  it('replaces the profile when a different user signs in', async () => {
    const controller = controllerFor();
    await controller.initialize();
    await controller.signIn(authResponse(USER_A));

    await controller.signIn(authResponse(USER_B));

    await expect(readUser(database)).resolves.toEqual(USER_B);
  });

  it('clears the profile on logout, along with the tokens', async () => {
    const controller = controllerFor();
    await controller.initialize();
    await controller.signIn(authResponse(USER_A));

    await controller.signOut();

    // The acceptance criterion in TVO-10: the next user on this device cannot see the
    // previous one - not their expenses, and not their email either.
    await expect(readUser(database)).resolves.toBeNull();
    await expect(controller.getAccessToken()).resolves.toBeNull();
  });

  it('stores emailVerified, reading an absent wire field as unverified', async () => {
    await writeUser(database, { ...USER_A, emailVerified: undefined });
    await expect(readUser(database)).resolves.toMatchObject({ emailVerified: false });

    await writeUser(database, { ...USER_A, emailVerified: true });
    await expect(readUser(database)).resolves.toMatchObject({ emailVerified: true });
  });

  it('keeps the display name, and lets it be cleared', async () => {
    await writeUser(database, {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: 'ada@example.com',
      displayName: 'Ada',
      currency: 'USD',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    expect((await readUser(database))?.displayName).toBe('Ada');

    await writeUser(database, {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: 'ada@example.com',
      displayName: null,
      currency: 'USD',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    expect((await readUser(database))?.displayName).toBeNull();
  });

  it('reads an older server answer, with no name at all, as none', async () => {
    await writeUser(database, {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: 'ada@example.com',
      currency: 'USD',
      createdAt: '2026-10-01T00:00:00.000Z',
    });

    expect((await readUser(database))?.displayName).toBeNull();
  });
});
