import { HouseholdListResponse, HouseholdResponse, MeResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';
import { makeHousehold } from './support/spaces.ts';

/**
 * Compatibility (`docs/design/13-multiple-households.md`, step 5): an app that predates spaces - it never
 * sends `X-Space-Id` and only knows the single-household routes - and households from before they had
 * books of their own, against the server that now allows several.
 */

const as = (user: TestUser) => ({ Authorization: user.auth });

/** An older app's whole household flow: no header, no names, the single-household routes. */
describe('an app that predates spaces', () => {
  it('can make, share, use and leave a household as it always could', async () => {
    const ada = await createUser();
    const bao = await createUser();

    const created = await api().post('/v1/household').set(as(ada)).send({});
    expect(created.status).toBe(201);
    const code = (await api().post('/v1/household/invite').set(as(ada)).send({})).body.data.code;
    expect((await api().post('/v1/household/join').set(as(bao)).send({ code })).status).toBe(200);

    // Both work in the household's book with no header: the one-household default.
    const categories = await api().get('/v1/categories').set(as(ada));
    const shared = await createExpense(ada, {
      categoryId: categories.body.data.find((c: { isDefault: boolean }) => c.isDefault).id,
    });
    const seen = await api().get('/v1/expenses').set(as(bao));
    expect(seen.body.data.map((e: { id: string }) => e.id)).toContain(shared.id);
    const household = HouseholdResponse.parse(
      (await api().get('/v1/household').set(as(bao))).body,
    ).household;
    expect(household?.members).toHaveLength(2);

    expect((await api().post('/v1/household/leave').set(as(bao)).send({})).status).toBe(204);
    const after = await api().get('/v1/expenses').set(as(bao));
    expect(after.body.data.map((e: { id: string }) => e.id)).not.toContain(shared.id);
  });

  it('keeps working in its own books when its account joins a second household elsewhere', async () => {
    const ada = await createUser();
    const personal = await createExpense(ada, { categoryId: ada.defaultCategory.id });
    await makeHousehold({ owner: ada, name: 'First' });
    await makeHousehold({ owner: ada, name: 'Second' });

    // No header and two households: the personal book, never a guess between the two.
    const expenses = await api().get('/v1/expenses').set(as(ada));
    expect(expenses.status).toBe(200);
    expect(expenses.body.data.map((e: { id: string }) => e.id)).toEqual([personal.id]);
    const mine = MeResponse.parse((await api().get('/v1/me').set(as(ada))).body);
    expect(mine.dataOwnerId).toBe(ada.user.id);
    expect(mine.household).toBeNull();
  });

  it('is told plainly, not misled, by the single-household routes once it is in several', async () => {
    const ada = await createUser();
    await makeHousehold({ owner: ada });
    await makeHousehold({ owner: ada });

    for (const [method, path] of [
      ['get', '/v1/household'],
      ['post', '/v1/household/invite'],
      ['post', '/v1/household/leave'],
      ['delete', '/v1/household'],
    ] as const) {
      const response = await api()[method](path).set(as(ada)).send({});
      expect([path, response.status, response.body.error.code]).toEqual([
        path,
        409,
        'household_ambiguous',
      ]);
    }
    // ...and the id-addressed list still works for it.
    const list = HouseholdListResponse.parse((await api().get('/v1/households').set(as(ada))).body);
    expect(list.households).toHaveLength(2);
  });
});

/** A household made before households had books: its rows are under the owner's own account id. */
describe('a household scoped by its owner’s own id', () => {
  async function legacyHousehold() {
    const owner = await createUser({ currency: 'USD' });
    const member = await createUser();
    const id = uuidv7();
    await getPrisma().household.create({
      data: {
        id,
        ownerId: owner.user.id,
        scopeId: owner.user.id,
        members: { create: { userId: owner.user.id, role: 'owner' } },
      },
    });
    const invite = await api().post(`/v1/households/${id}/invite`).set(as(owner)).send({});
    expect(invite.status).toBe(201);
    const joined = await api()
      .post('/v1/household/join')
      .set(as(member))
      .send({ code: invite.body.data.code });
    expect(joined.status).toBe(200);
    return { owner, member, id };
  }

  it('can be renamed and managed by id like any other', async () => {
    const { owner, id } = await legacyHousehold();

    const renamed = await api()
      .patch(`/v1/households/${id}`)
      .set(as(owner))
      .send({ name: 'Old home' });

    expect(renamed.status).toBe(200);
    expect(HouseholdResponse.parse(renamed.body).household?.name).toBe('Old home');
  });

  it('keeps its rows when the only other member leaves, so there is no one left to hand it to', async () => {
    const { owner, member, id } = await legacyHousehold();
    const row = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    expect((await api().post(`/v1/households/${id}/leave`).set(as(member)).send({})).status).toBe(
      204,
    );
    const handed = await api()
      .post(`/v1/households/${id}/transfer`)
      .set(as(owner))
      .send({ memberId: member.user.id });
    // Only a member can be handed it: with none left it is a 404, and nothing changes.
    expect(handed.status).toBe(404);
    expect(await getPrisma().expense.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      userId: owner.user.id,
    });
  });

  it('moves its rows into a book of their own when handed over, so the old owner’s account is clean', async () => {
    const { owner, member, id } = await legacyHousehold();
    const row = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    const handed = await api()
      .post(`/v1/households/${id}/transfer`)
      .set(as(owner))
      .send({ memberId: member.user.id });

    expect(handed.status).toBe(200);
    const moved = await getPrisma().expense.findUniqueOrThrow({ where: { id: row.id } });
    expect(moved.userId).not.toBe(owner.user.id);
    const household = await getPrisma().household.findUniqueOrThrow({ where: { id } });
    expect(moved.userId).toBe(household.scopeId);
  });

  it('is deleted without moving anything, the owner keeping the rows', async () => {
    const { owner, id } = await legacyHousehold();
    const row = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    const deleted = await api().delete(`/v1/households/${id}`).set(as(owner));

    expect(deleted.status).toBe(204);
    expect(await getPrisma().household.count({ where: { id } })).toBe(0);
    expect(await getPrisma().expense.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      userId: owner.user.id,
    });
  });
});
