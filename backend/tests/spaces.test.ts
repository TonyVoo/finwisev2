import { MeResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createUser, type TestUser } from './support/fixtures.ts';
import { makeHousehold } from './support/spaces.ts';

/**
 * Spaces (`docs/design/13-multiple-households.md`): a person can be in several households, and each request
 * names the book it works in with `X-Space-Id`. These cases are the server's half of step 1: the model
 * allows it, the header is resolved and validated every time, and `GET /v1/me` lists the choices. The routes
 * that create or join a household still refuse a second one until step 2, so the extra households are built
 * in the database (`tests/support/spaces.ts`).
 */

const me = (user: TestUser, space?: string) => {
  const request = api().get('/v1/me').set('Authorization', user.auth);
  return space === undefined ? request : request.set('X-Space-Id', space);
};

const categories = (user: TestUser, space?: string) => {
  const request = api().get('/v1/categories').set('Authorization', user.auth);
  return space === undefined ? request : request.set('X-Space-Id', space);
};

describe('the model', () => {
  it('lets one person be in two households, and own both', async () => {
    const ada = await createUser();
    const first = await makeHousehold({ owner: ada, name: 'Home' });
    const second = await makeHousehold({ owner: ada, name: 'Flat' });

    const memberships = await getPrisma().householdMember.findMany({
      where: { userId: ada.user.id },
    });
    const owned = await getPrisma().household.findMany({ where: { ownerId: ada.user.id } });

    expect(memberships.map((row) => row.householdId).sort()).toEqual(
      [first.householdId, second.householdId].sort(),
    );
    expect(owned).toHaveLength(2);
  });

  it('names a household "Household" until it is named', async () => {
    const ada = await createUser();
    const made = await makeHousehold({ owner: ada });

    const row = await getPrisma().household.findUniqueOrThrow({ where: { id: made.householdId } });

    expect(row.name).toBe('Household');
  });

  it('refuses an empty household name, at the storage layer', async () => {
    const ada = await createUser();
    const made = await makeHousehold({ owner: ada });

    await expect(
      getPrisma().household.update({ where: { id: made.householdId }, data: { name: '' } }),
    ).rejects.toThrow();
  });
});

describe('which book a request works in', () => {
  it('is the personal one for a person in no household, with or without the header', async () => {
    const ada = await createUser();

    expect((await me(ada)).body.dataOwnerId).toBe(ada.user.id);
    expect((await me(ada, ada.user.id)).body.dataOwnerId).toBe(ada.user.id);
  });

  it('is the household for a person in exactly one, when no header says otherwise (an older app)', async () => {
    const ada = await createUser();
    const home = await makeHousehold({ owner: ada });

    expect((await me(ada)).body.dataOwnerId).toBe(home.scopeId);
  });

  it('is the personal one for a person in several, when no header says which', async () => {
    const ada = await createUser();
    await makeHousehold({ owner: ada });
    await makeHousehold({ owner: ada });

    expect((await me(ada)).body.dataOwnerId).toBe(ada.user.id);
  });

  it('is whichever the header names, among the ones the person belongs to', async () => {
    const ada = await createUser();
    const home = await makeHousehold({ owner: ada });
    const flat = await makeHousehold({ owner: ada });

    expect((await me(ada, home.scopeId)).body.dataOwnerId).toBe(home.scopeId);
    expect((await me(ada, flat.scopeId)).body.dataOwnerId).toBe(flat.scopeId);
    // Naming the personal space works even while in a household, which is how the app switches back.
    expect((await me(ada, ada.user.id)).body.dataOwnerId).toBe(ada.user.id);
  });

  it('is decided per request, so two devices of one account can be in different spaces', async () => {
    const ada = await createUser();
    const home = await makeHousehold({ owner: ada });
    const flat = await makeHousehold({ owner: ada });

    const [phone, tablet] = await Promise.all([me(ada, home.scopeId), me(ada, flat.scopeId)]);

    expect(phone.body.dataOwnerId).toBe(home.scopeId);
    expect(tablet.body.dataOwnerId).toBe(flat.scopeId);
  });

  it('applies to the data routes, not just /me', async () => {
    const ada = await createUser();
    const home = await makeHousehold({ owner: ada });

    const personal = await categories(ada, ada.user.id);
    const shared = await categories(ada, home.scopeId);

    expect(personal.body.data.length).toBeGreaterThan(0);
    expect(shared.body.data).toEqual([]);

    const created = await api()
      .post('/v1/categories')
      .set('Authorization', ada.auth)
      .set('X-Space-Id', home.scopeId)
      .send({ name: 'Rent' });
    expect(created.status).toBe(201);
    expect(
      (await categories(ada, home.scopeId)).body.data.map((c: { name: string }) => c.name),
    ).toEqual(['Rent']);
    expect(
      (await categories(ada, ada.user.id)).body.data.map((c: { name: string }) => c.name),
    ).not.toContain('Rent');
  });

  describe('a header that does not name one of the person’s own spaces', () => {
    const cases = async () => {
      const ada = await createUser();
      const bao = await createUser();
      const home = await makeHousehold({ owner: ada });
      const strangers = await makeHousehold({ owner: bao });
      return {
        ada,
        refused: [
          ['a household they are not in', strangers.scopeId],
          ['another person’s personal space', bao.user.id],
          ['an id that does not exist', uuidv7()],
          ['something that is not an id', 'not-a-uuid'],
          ['an empty value', ''],
        ] as const,
        home,
      };
    };

    it('is 404 not_found, the same answer for all of them, so spaces cannot be probed', async () => {
      const { ada, refused } = await cases();
      const bodies = new Set<string>();

      for (const [, value] of refused) {
        const response = await categories(ada, value);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('not_found');
        // Names the header, never the value, so a device can tell this from any other 404.
        expect(response.body.error.details).toEqual({ header: 'X-Space-Id' });
        bodies.add(JSON.stringify({ ...response.body.error, requestId: undefined }));
      }
      expect(bodies.size).toBe(1);
    });

    it('is refused on every authenticated route, not only the ones that read', async () => {
      const { ada, refused } = await cases();
      const [, stranger] = refused[0];

      const write = await api()
        .post('/v1/categories')
        .set('Authorization', ada.auth)
        .set('X-Space-Id', stranger)
        .send({ name: 'Nope' });

      expect(write.status).toBe(404);
    });

    it('is refused after the person has left the household it names', async () => {
      const ada = await createUser();
      const bao = await createUser();
      const home = await makeHousehold({ owner: ada, members: [bao] });
      expect((await me(bao, home.scopeId)).status).toBe(200);

      await getPrisma().householdMember.deleteMany({
        where: { householdId: home.householdId, userId: bao.user.id },
      });

      expect((await me(bao, home.scopeId)).status).toBe(404);
    });
  });
});

describe('GET /v1/me', () => {
  it('lists the personal space, then the households by when the person joined', async () => {
    const ada = await createUser({ currency: 'USD' });
    const early = await makeHousehold({
      owner: ada,
      name: 'Early',
      currency: 'VND',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const late = await makeHousehold({
      owner: ada,
      name: 'Late',
      currency: 'EUR',
      joinedAt: new Date('2026-06-01T00:00:00Z'),
    });

    const body = MeResponse.parse((await me(ada)).body);

    expect(body.spaces).toEqual([
      { id: ada.user.id, kind: 'personal', name: null, currency: 'USD' },
      {
        id: early.scopeId,
        kind: 'household',
        householdId: early.householdId,
        name: 'Early',
        role: 'owner',
        currency: 'VND',
      },
      {
        id: late.scopeId,
        kind: 'household',
        householdId: late.householdId,
        name: 'Late',
        role: 'owner',
        currency: 'EUR',
      },
    ]);
  });

  it('says what role the person has in each', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const theirs = await makeHousehold({ owner: bao, members: [ada], name: 'Bao’s' });

    const body = MeResponse.parse((await me(ada)).body);

    expect(body.spaces?.[1]).toMatchObject({ householdId: theirs.householdId, role: 'member' });
  });

  it('has only the personal space for a person in no household', async () => {
    const ada = await createUser();

    expect(MeResponse.parse((await me(ada)).body).spaces).toEqual([
      { id: ada.user.id, kind: 'personal', name: null, currency: ada.user.currency },
    ]);
  });

  it('reports the active space’s currency and household, as it already does while in one', async () => {
    const ada = await createUser({ currency: 'USD' });
    const home = await makeHousehold({ owner: ada, name: 'Home', currency: 'VND' });

    const inHome = MeResponse.parse((await me(ada, home.scopeId)).body);
    const personal = MeResponse.parse((await me(ada, ada.user.id)).body);

    expect(inHome.user.currency).toBe('VND');
    expect(inHome.household?.id).toBe(home.householdId);
    expect(personal.user.currency).toBe('USD');
    // In the personal space there is no household in view, even though the person belongs to one.
    expect(personal.household).toBeNull();
  });

  it('lists a household scoped by its owner’s own id once, as the household: it is the book that id selects', async () => {
    // From before households had books of their own: the household's rows live under the owner's account.
    const ada = await createUser({ currency: 'USD' });
    const householdId = uuidv7();
    await getPrisma().household.create({
      data: {
        id: householdId,
        ownerId: ada.user.id,
        scopeId: ada.user.id,
        name: 'Old home',
        members: { create: { userId: ada.user.id, role: 'owner' } },
      },
    });

    const body = MeResponse.parse((await me(ada)).body);

    expect(body.spaces).toEqual([
      {
        id: ada.user.id,
        kind: 'household',
        householdId,
        name: 'Old home',
        role: 'owner',
        currency: 'USD',
      },
    ]);
    expect(body.household?.id).toBe(householdId);
  });

  it('lists the same spaces whichever one is active', async () => {
    const ada = await createUser();
    const home = await makeHousehold({ owner: ada });

    const fromPersonal = MeResponse.parse((await me(ada, ada.user.id)).body);
    const fromHome = MeResponse.parse((await me(ada, home.scopeId)).body);

    expect(fromHome.spaces).toEqual(fromPersonal.spaces);
  });
});

describe('the one-household routes, for a person who is in several', () => {
  it.each([
    ['GET', '/v1/household'],
    ['POST', '/v1/household/invite'],
    ['POST', '/v1/household/leave'],
    ['DELETE', '/v1/household'],
  ] as const)('%s %s is 409 household_ambiguous', async (method, path) => {
    const ada = await createUser();
    await makeHousehold({ owner: ada });
    await makeHousehold({ owner: ada });

    const request = api()
      [method.toLowerCase() as 'get' | 'post' | 'delete'](path)
      .set('Authorization', ada.auth);
    const response =
      method === 'GET' || method === 'DELETE' ? await request : await request.send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('household_ambiguous');
  });

  it('still answers a person in exactly one, as before', async () => {
    const ada = await createUser();
    const home = await makeHousehold({ owner: ada });

    const response = await api().get('/v1/household').set('Authorization', ada.auth);

    expect(response.status).toBe(200);
    expect(response.body.household.id).toBe(home.householdId);
  });
});

describe('deleting an account that owns households', () => {
  it('is refused while any household the person owns still has other people in it', async () => {
    const ada = await createUser();
    const bao = await createUser();
    await makeHousehold({ owner: ada });
    await makeHousehold({ owner: ada, members: [bao] });

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', ada.auth)
      .send({ password: ada.password });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('household_has_members');
  });

  it('takes every household the person owns alone, books and all', async () => {
    const ada = await createUser();
    const first = await makeHousehold({ owner: ada });
    const second = await makeHousehold({ owner: ada });

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', ada.auth)
      .send({ password: ada.password });

    expect(response.status).toBe(204);
    expect(
      await getPrisma().household.count({
        where: { id: { in: [first.householdId, second.householdId] } },
      }),
    ).toBe(0);
    expect(
      await getPrisma().user.count({ where: { id: { in: [first.scopeId, second.scopeId] } } }),
    ).toBe(0);
  });
});
