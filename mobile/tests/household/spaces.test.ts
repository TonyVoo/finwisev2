import type { MeResponse, Space } from '@expense-tracker/shared';
import { ApiRequestError, NetworkUnavailableError } from '@/api/errors';
import { migrate } from '@/db/migrations';
import { META_KEYS, WIPED_META_KEYS, readMeta, writeMeta } from '@/db/meta';
import { reconcileDataScope } from '@/household/dataScope';
import { readSpaces } from '@/household/spaces';
import { applyLocalMutation } from '@/db/write';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * The phone's side of several households (`docs/design/13-multiple-households.md`): the device holds one
 * space, remembers which, names it on every request, keeps the list for the switcher, and falls back to the
 * personal space when the one it holds is gone.
 */

const ME_ID = '0192f5a0-0000-7000-8000-00000000a001';
const HOME_BOOK = '0192f5a0-0000-7000-8000-00000000b001';
const FLAT_BOOK = '0192f5a0-0000-7000-8000-00000000b002';
const GONE_BOOK = '0192f5a0-0000-7000-8000-00000000b003';
const CATEGORY_ID = '0192f5a0-0000-7000-8000-0000000000c1';
const WRITTEN_AT = new Date('2026-10-09T09:00:00.000Z');

const SPACES: Space[] = [
  { id: ME_ID, kind: 'personal', name: null, currency: 'EUR' },
  {
    id: HOME_BOOK,
    kind: 'household',
    householdId: '0192f5a0-0000-7000-8000-00000000d001',
    name: 'Home',
    role: 'owner',
    currency: 'USD',
  },
  {
    id: FLAT_BOOK,
    kind: 'household',
    householdId: '0192f5a0-0000-7000-8000-00000000d002',
    name: 'Flat',
    role: 'member',
    currency: 'GBP',
  },
];

const spaceGone = () =>
  new ApiRequestError({
    status: 404,
    code: 'not_found',
    message: 'No such space.',
    details: { header: 'X-Space-Id' },
  });

/** A server holding SPACES: the space asked for, else (no header) the default it picks. */
function server(options: { defaultSpace?: string; spaces?: Space[] } = {}) {
  const spaces = options.spaces ?? SPACES;
  const asked: Array<string | null | undefined> = [];
  return {
    asked,
    getMe: async (request?: { spaceId?: string | null }): Promise<MeResponse> => {
      asked.push(request?.spaceId);
      const wanted = request?.spaceId ?? options.defaultSpace ?? ME_ID;
      const space = spaces.find((candidate) => candidate.id === wanted);
      if (space === undefined) throw spaceGone();
      return {
        user: {
          id: ME_ID,
          email: 'ana@example.com',
          currency: space.currency,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
        dataOwnerId: space.id,
        household: null,
        spaces,
      };
    },
  };
}

describe('the device and its spaces', () => {
  let database: TestDatabase;

  async function count(table: string): Promise<number> {
    const row = await database.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table}`,
      [],
    );
    return row!.n;
  }

  async function seedRows(): Promise<void> {
    await applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_ID, fields: { name: 'Groceries', color: '#2F8044' } },
      { clock: () => WRITTEN_AT, newMutationId: () => '0192f5a0-0000-7000-8000-300000000001' },
    );
    await writeMeta(database, META_KEYS.syncCursor, '42');
  }

  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
    await writeMeta(database, META_KEYS.owner, ME_ID);
  });
  afterEach(() => database.close());

  it('asks with no space the first time, and takes the one the server picks', async () => {
    const api = server({ defaultSpace: HOME_BOOK });

    const result = await reconcileDataScope(database, api);

    expect(api.asked).toEqual([undefined]);
    expect(result).toBe('switched');
    expect(await readMeta(database, META_KEYS.dataScope)).toBe(HOME_BOOK);
  });

  it('then asks for the space it holds, so a device stays where it was left', async () => {
    const api = server({ defaultSpace: ME_ID });
    await reconcileDataScope(database, server({ defaultSpace: HOME_BOOK }));

    const result = await reconcileDataScope(database, api);

    expect(api.asked).toEqual([HOME_BOOK]);
    expect(result).toBe('unchanged');
    expect(await readMeta(database, META_KEYS.dataScope)).toBe(HOME_BOOK);
  });

  it('keeps the list of spaces for the switcher, and renews it each time', async () => {
    await reconcileDataScope(database, server());
    expect((await readSpaces(database)).map((space) => space.name)).toEqual([null, 'Home', 'Flat']);

    await reconcileDataScope(database, server({ spaces: SPACES.slice(0, 2) }));

    expect((await readSpaces(database)).map((space) => space.name)).toEqual([null, 'Home']);
  });

  it('has no spaces to show before the first answer, or from an older server', async () => {
    expect(await readSpaces(database)).toEqual([]);
    await reconcileDataScope(database, {
      getMe: async () => ({
        user: {
          id: ME_ID,
          email: 'ana@example.com',
          currency: 'EUR',
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      }),
    });
    expect(await readSpaces(database)).toEqual([]);
  });

  it('keeps the list through a switch, which wipes everything else about the old space', async () => {
    await reconcileDataScope(database, server());
    await seedRows();

    const result = await reconcileDataScope(database, server(), { target: FLAT_BOOK });

    expect(result).toBe('switched');
    expect((await readSpaces(database)).map((space) => space.name)).toEqual([null, 'Home', 'Flat']);
    expect(await count('categories')).toBe(0);
    expect(await readMeta(database, META_KEYS.syncCursor)).toBeNull();
  });

  describe('switching on purpose', () => {
    it('asks for the chosen space, wipes the old one and takes its currency', async () => {
      await reconcileDataScope(database, server());
      await seedRows();
      const api = server();

      const result = await reconcileDataScope(database, api, { target: HOME_BOOK });

      expect(api.asked).toEqual([HOME_BOOK]);
      expect(result).toBe('switched');
      expect(await readMeta(database, META_KEYS.dataScope)).toBe(HOME_BOOK);
      expect(await count('categories')).toBe(0);
      expect(await count('outbox')).toBe(0);
      const user = await database.getFirstAsync<{ currency: string }>(
        'SELECT currency FROM user',
        [],
      );
      expect(user?.currency).toBe('USD');
    });

    it('can go back to the personal space', async () => {
      await reconcileDataScope(database, server(), { target: HOME_BOOK });

      const result = await reconcileDataScope(database, server(), { target: ME_ID });

      expect(result).toBe('switched');
      expect(await readMeta(database, META_KEYS.dataScope)).toBe(ME_ID);
    });

    it('changes nothing when already in that space', async () => {
      await reconcileDataScope(database, server(), { target: HOME_BOOK });
      await seedRows();

      const result = await reconcileDataScope(database, server(), { target: HOME_BOOK });

      expect(result).toBe('unchanged');
      expect(await count('categories')).toBe(1);
    });

    it('is skipped, and nothing is lost, when the chosen space is not there', async () => {
      await reconcileDataScope(database, server(), { target: HOME_BOOK });
      await seedRows();

      const result = await reconcileDataScope(database, server(), { target: GONE_BOOK });

      expect(result).toBe('skipped');
      expect(await readMeta(database, META_KEYS.dataScope)).toBe(HOME_BOOK);
      expect(await count('categories')).toBe(1);
    });
  });

  describe('when the space the device holds is gone', () => {
    it('falls back to the personal space and clears the old space’s rows', async () => {
      await reconcileDataScope(database, server(), { target: FLAT_BOOK });
      await seedRows();
      const api = server({ spaces: SPACES.filter((space) => space.id !== FLAT_BOOK) });

      const result = await reconcileDataScope(database, api);

      expect(api.asked).toEqual([FLAT_BOOK, ME_ID]);
      expect(result).toBe('switched');
      expect(await readMeta(database, META_KEYS.dataScope)).toBe(ME_ID);
      expect(await count('categories')).toBe(0);
      expect((await readSpaces(database)).map((space) => space.name)).toEqual([null, 'Home']);
    });

    it('does not mistake any other 404 for it', async () => {
      await reconcileDataScope(database, server(), { target: FLAT_BOOK });
      await seedRows();

      const result = await reconcileDataScope(database, {
        getMe: async () => {
          throw new ApiRequestError({ status: 404, code: 'not_found', message: 'Not found.' });
        },
      });

      expect(result).toBe('skipped');
      expect(await readMeta(database, META_KEYS.dataScope)).toBe(FLAT_BOOK);
      expect(await count('categories')).toBe(1);
    });

    it('does nothing offline', async () => {
      await reconcileDataScope(database, server(), { target: FLAT_BOOK });

      const result = await reconcileDataScope(database, {
        getMe: async () => {
          throw new NetworkUnavailableError(new Error('offline'));
        },
      });

      expect(result).toBe('skipped');
      expect(await readMeta(database, META_KEYS.dataScope)).toBe(FLAT_BOOK);
    });
  });

  it('forgets the spaces when the account changes, like everything else about the books', () => {
    expect(WIPED_META_KEYS).toContain(META_KEYS.spaces);
  });
});
