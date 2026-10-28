import type { MeResponse } from '@expense-tracker/shared';
import { migrate } from '@/db/migrations';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import { readUser } from '@/db/user';
import { reconcileDataScope } from '@/household/dataScope';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Whose rows this device holds. The server says (`GET /v1/me` `dataOwnerId`): the account's own
 * id, or - while it is in a household - the owner's. A device that holds one scope's rows must
 * never push them to, or pull a cursor from, another.
 */

const ME_ID = '0192f5a0-0000-7000-8000-00000000a001';
const OWNER_ID = '0192f5a0-0000-7000-8000-00000000b001';
const CATEGORY_ID = '0192f5a0-0000-7000-8000-0000000000c1';
const WRITTEN_AT = new Date('2026-10-09T09:00:00.000Z');

function me(
  overrides: { dataOwnerId?: string; currency?: string; household?: MeResponse['household'] } = {},
): MeResponse {
  return {
    user: {
      id: ME_ID,
      email: 'ana@example.com',
      currency: overrides.currency ?? 'EUR',
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    ...(overrides.dataOwnerId === undefined ? {} : { dataOwnerId: overrides.dataOwnerId }),
    ...(overrides.household === undefined ? {} : { household: overrides.household }),
  };
}

describe('reconcileDataScope', () => {
  let database: TestDatabase;

  async function stampIdentity(): Promise<void> {
    await writeMeta(database, META_KEYS.owner, ME_ID);
  }

  async function seedRows(): Promise<void> {
    await applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
      { clock: () => WRITTEN_AT, newMutationId: () => '0192f5a0-0000-7000-8000-300000000001' },
    );
    await writeMeta(database, META_KEYS.syncCursor, '42');
  }

  async function count(table: string): Promise<number> {
    const row = await database.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table}`,
      [],
    );
    return row!.n;
  }

  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
    await stampIdentity();
  });
  afterEach(() => database.close());

  it('stamps the scope and changes nothing for an account on its own books', async () => {
    await seedRows();

    const result = await reconcileDataScope(database, {
      getMe: async () => me({ dataOwnerId: ME_ID }),
    });

    expect(result).toBe('unchanged');
    expect(await readMeta(database, META_KEYS.dataScope)).toBe(ME_ID);
    expect(await count('categories')).toBe(1);
    expect(await readMeta(database, META_KEYS.syncCursor)).toBe('42');
  });

  it("treats a server that predates households as the account's own books", async () => {
    await seedRows();

    const result = await reconcileDataScope(database, { getMe: async () => me() });

    expect(result).toBe('unchanged');
    expect(await count('categories')).toBe(1);
  });

  it('wipes the rows, the outbox and the sync cursor when the scope becomes a household', async () => {
    await seedRows();
    await reconcileDataScope(database, { getMe: async () => me({ dataOwnerId: ME_ID }) });

    const result = await reconcileDataScope(database, {
      getMe: async () => me({ dataOwnerId: OWNER_ID, currency: 'USD' }),
    });

    expect(result).toBe('switched');
    expect(await count('categories')).toBe(0);
    expect(await count('outbox')).toBe(0);
    expect(await readMeta(database, META_KEYS.syncCursor)).toBeNull();
    expect(await readMeta(database, META_KEYS.dataScope)).toBe(OWNER_ID);
  });

  it('takes the household currency into the local profile', async () => {
    await reconcileDataScope(database, { getMe: async () => me({ dataOwnerId: ME_ID }) });

    await reconcileDataScope(database, {
      getMe: async () => me({ dataOwnerId: OWNER_ID, currency: 'USD' }),
    });

    expect((await readUser(database))?.currency).toBe('USD');
  });

  it('switches back when the account leaves', async () => {
    await reconcileDataScope(database, {
      getMe: async () => me({ dataOwnerId: OWNER_ID, currency: 'USD' }),
    });
    await seedRows();

    const result = await reconcileDataScope(database, {
      getMe: async () => me({ dataOwnerId: ME_ID, currency: 'EUR' }),
    });

    expect(result).toBe('switched');
    expect(await count('categories')).toBe(0);
    expect(await readMeta(database, META_KEYS.dataScope)).toBe(ME_ID);
    expect((await readUser(database))?.currency).toBe('EUR');
  });

  it('leaves the account identity and device settings alone', async () => {
    await writeMeta(database, META_KEYS.themePreference, 'dark');
    await reconcileDataScope(database, { getMe: async () => me({ dataOwnerId: ME_ID }) });

    await reconcileDataScope(database, { getMe: async () => me({ dataOwnerId: OWNER_ID }) });

    expect(await readMeta(database, META_KEYS.owner)).toBe(ME_ID);
    expect(await readMeta(database, META_KEYS.themePreference)).toBe('dark');
  });

  it('does nothing, and says so, when the server cannot be asked', async () => {
    await seedRows();
    await reconcileDataScope(database, { getMe: async () => me({ dataOwnerId: ME_ID }) });

    const result = await reconcileDataScope(database, {
      getMe: async () => {
        throw new Error('offline');
      },
    });

    expect(result).toBe('skipped');
    expect(await count('categories')).toBe(1);
  });

  it('is a no-op the second time for the same scope', async () => {
    const api = { getMe: async () => me({ dataOwnerId: OWNER_ID }) };
    await reconcileDataScope(database, api);
    await seedRows();

    const again = await reconcileDataScope(database, api);

    expect(again).toBe('unchanged');
    expect(await count('categories')).toBe(1);
  });

  describe('who is in the household, for labelling rows offline', () => {
    const household = {
      id: '0192f5a0-0000-7000-8000-00000000c001',
      role: 'member' as const,
      ownerId: OWNER_ID,
      currency: 'USD',
      members: [
        {
          userId: OWNER_ID,
          email: 'bao@example.com',
          displayName: 'Bảo',
          role: 'owner' as const,
          joinedAt: '2026-10-01T00:00:00.000Z',
        },
        {
          userId: ME_ID,
          email: 'ana@example.com',
          displayName: null,
          role: 'member' as const,
          joinedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
    };

    it('keeps the members the server reports', async () => {
      await reconcileDataScope(database, {
        getMe: async () => me({ dataOwnerId: OWNER_ID, household }),
      });

      expect(JSON.parse((await readMeta(database, META_KEYS.householdMembers)) ?? 'null')).toEqual([
        {
          userId: OWNER_ID,
          email: 'bao@example.com',
          displayName: 'Bảo',
          joinedAt: '2026-10-01T00:00:00.000Z',
        },
        {
          userId: ME_ID,
          email: 'ana@example.com',
          displayName: null,
          joinedAt: '2026-10-02T00:00:00.000Z',
        },
      ]);
    });

    it('refreshes them even when the scope did not change', async () => {
      const api = (members: typeof household.members) => ({
        getMe: async () => me({ dataOwnerId: OWNER_ID, household: { ...household, members } }),
      });
      await reconcileDataScope(database, api(household.members));

      const result = await reconcileDataScope(database, api([household.members[0]!]));

      expect(result).toBe('unchanged');
      expect(JSON.parse((await readMeta(database, META_KEYS.householdMembers)) ?? 'null')).toEqual([
        {
          userId: OWNER_ID,
          email: 'bao@example.com',
          displayName: 'Bảo',
          joinedAt: '2026-10-01T00:00:00.000Z',
        },
      ]);
    });

    it('forgets them when the account is in no household', async () => {
      await reconcileDataScope(database, {
        getMe: async () => me({ dataOwnerId: OWNER_ID, household }),
      });

      await reconcileDataScope(database, {
        getMe: async () => me({ dataOwnerId: ME_ID, household: null }),
      });

      expect(await readMeta(database, META_KEYS.householdMembers)).toBeNull();
    });

    it('forgets them when an older server does not say', async () => {
      await reconcileDataScope(database, {
        getMe: async () => me({ dataOwnerId: OWNER_ID, household }),
      });

      await reconcileDataScope(database, { getMe: async () => me({ dataOwnerId: OWNER_ID }) });

      expect(await readMeta(database, META_KEYS.householdMembers)).toBeNull();
    });
  });
});
