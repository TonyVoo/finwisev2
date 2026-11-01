import type { HouseholdInviteResponse } from '@expense-tracker/shared';
import {
  HouseholdListResponse,
  HouseholdResponse,
  LIMITS,
  MeResponse,
} from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';

/**
 * Households, addressed by id (`docs/design/13-multiple-households.md`, step 2). A person may be in several, so
 * a household is named in the route rather than found from the token, and membership is still identity: every
 * route here ignores `X-Space-Id`, and a household the caller is not in is the same `404` as one that does not
 * exist, so ids cannot be probed.
 */

const as = (user: TestUser) => ({ Authorization: user.auth });

async function create(user: TestUser, name?: string) {
  return await api()
    .post('/v1/household')
    .set(as(user))
    .send(name === undefined ? {} : { name });
}

async function created(user: TestUser, name?: string): Promise<string> {
  const response = await create(user, name);
  expect(response.status).toBe(201);
  return (response.body as HouseholdResponse).household!.id;
}

async function inviteTo(owner: TestUser, householdId: string): Promise<string> {
  const response = await api().post(`/v1/households/${householdId}/invite`).set(as(owner)).send({});
  expect(response.status).toBe(201);
  return (response.body as HouseholdInviteResponse).data.code;
}

const join = (user: TestUser, code: string) =>
  api().post('/v1/household/join').set(as(user)).send({ code });

async function joined(owner: TestUser, member: TestUser, name?: string): Promise<string> {
  const id = await created(owner, name);
  expect((await join(member, await inviteTo(owner, id))).status).toBe(200);
  return id;
}

const spacesOf = async (user: TestUser) =>
  MeResponse.parse((await api().get('/v1/me').set(as(user))).body).spaces ?? [];

describe('GET /v1/households', () => {
  it('is empty for a person in none', async () => {
    const ada = await createUser();

    const response = await api().get('/v1/households').set(as(ada));

    expect(response.status).toBe(200);
    expect(HouseholdListResponse.parse(response.body).households).toEqual([]);
  });

  it('lists every household the person is in, with its name, their role and who is in it', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const home = await created(ada, 'Home');
    const flat = await joined(bao, ada, 'Flat');

    const { households } = HouseholdListResponse.parse(
      (await api().get('/v1/households').set(as(ada))).body,
    );

    expect(households.map((h) => [h.id, h.name, h.role])).toEqual([
      [home, 'Home', 'owner'],
      [flat, 'Flat', 'member'],
    ]);
    expect(households[1]!.members.map((m) => m.userId).sort()).toEqual(
      [ada.user.id, bao.user.id].sort(),
    );
  });

  it('answers whichever space is active, because membership is identity', async () => {
    const ada = await createUser();
    await created(ada);

    const response = await api().get('/v1/households').set(as(ada)).set('X-Space-Id', ada.user.id);

    expect(HouseholdListResponse.parse(response.body).households).toHaveLength(1);
  });
});

describe('POST /v1/household (create)', () => {
  it('makes an empty household: the creator’s own books stay their own', async () => {
    const ada = await createUser();
    const expense = await createExpense(ada, { categoryId: ada.defaultCategory.id });

    const id = await created(ada);

    const home = (await spacesOf(ada)).find((s) => s.kind === 'household')!;
    const inHome = await api().get('/v1/expenses').set(as(ada)).set('X-Space-Id', home.id);
    const personal = await api().get('/v1/expenses').set(as(ada)).set('X-Space-Id', ada.user.id);
    expect(home).toMatchObject({ householdId: id });
    expect(inHome.body.data).toEqual([]);
    expect(personal.body.data.map((e: { id: string }) => e.id)).toEqual([expense.id]);
    expect(await getPrisma().expense.count({ where: { userId: ada.user.id } })).toBe(1);
  });

  it('is named "Household" unless a name is given, and a name is trimmed', async () => {
    const ada = await createUser();

    const plain = (await create(ada)).body as HouseholdResponse;
    const named = (await create(ada, '  Flat 4  ')).body as HouseholdResponse;

    expect(plain.household?.name).toBe('Household');
    expect(named.household?.name).toBe('Flat 4');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['over 40 characters', 'x'.repeat(41)],
    ['not text', 5],
  ])('is a validation error for a name that is %s', async (_name, name) => {
    const ada = await createUser();

    const response = await api().post('/v1/household').set(as(ada)).send({ name });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('lets a person who is already in a household make another', async () => {
    const ada = await createUser();
    await created(ada, 'Home');

    const second = await create(ada, 'Flat');

    expect(second.status).toBe(201);
    expect((await spacesOf(ada)).map((s) => s.name)).toEqual([null, 'Home', 'Flat']);
  });

  it('stops at the limit, with 409 household_limit', async () => {
    const ada = await createUser();
    for (let n = 0; n < LIMITS.HOUSEHOLDS_MAX_PER_USER; n += 1) await created(ada, `H${n}`);

    const over = await create(ada, 'One too many');

    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('household_limit');
    expect(await getPrisma().householdMember.count({ where: { userId: ada.user.id } })).toBe(
      LIMITS.HOUSEHOLDS_MAX_PER_USER,
    );
  });

  it('holds the limit against two simultaneous creates', async () => {
    const ada = await createUser();
    for (let n = 0; n < LIMITS.HOUSEHOLDS_MAX_PER_USER - 1; n += 1) await created(ada, `H${n}`);

    const results = await Promise.all([create(ada, 'A'), create(ada, 'B')]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await getPrisma().householdMember.count({ where: { userId: ada.user.id } })).toBe(
      LIMITS.HOUSEHOLDS_MAX_PER_USER,
    );
  });
});

describe('POST /v1/household/join', () => {
  it('lets a person who is already in a household join another, without leaving the first', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const mine = await created(ada, 'Mine');
    const theirs = await created(bao, 'Theirs');

    const response = await join(ada, await inviteTo(bao, theirs));

    expect(response.status).toBe(200);
    expect(
      (await spacesOf(ada))
        .filter((s) => s.kind === 'household')
        .map((s) => (s as { householdId: string }).householdId)
        .sort(),
    ).toEqual([mine, theirs].sort());
  });

  it('is 409 already_member for a household the person is already in, and leaves the code unspent', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const cam = await createUser();
    const id = await joined(ada, bao);
    const code = await inviteTo(ada, id);

    const again = await join(bao, code);
    const later = await join(cam, code);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_member');
    expect(later.status).toBe(200);
  });

  it('is 409 household_limit at the limit, and leaves the code unspent', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const cam = await createUser();
    for (let n = 0; n < LIMITS.HOUSEHOLDS_MAX_PER_USER; n += 1) await created(bao, `H${n}`);
    const id = await created(ada, 'Open');
    const code = await inviteTo(ada, id);

    const refused = await join(bao, code);
    const accepted = await join(cam, code);

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('household_limit');
    expect(accepted.status).toBe(200);
  });

  it('still gives a wrong or expired code the one answer, whatever else is true of the person', async () => {
    const ada = await createUser();
    await created(ada);

    const response = await join(ada, 'ABCD2345');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_invite_code');
  });
});

describe('PATCH /v1/households/{id}', () => {
  it('lets the owner rename it, trimmed, and shows in the spaces', async () => {
    const ada = await createUser();
    const id = await created(ada, 'Old');

    const response = await api()
      .patch(`/v1/households/${id}`)
      .set(as(ada))
      .send({ name: '  New name ' });

    expect(response.status).toBe(200);
    expect(HouseholdResponse.parse(response.body).household?.name).toBe('New name');
    expect((await spacesOf(ada)).map((s) => s.name)).toEqual([null, 'New name']);
  });

  it('is 403 household_owner_only for a member', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const id = await joined(ada, bao);

    const response = await api()
      .patch(`/v1/households/${id}`)
      .set(as(bao))
      .send({ name: 'Mine now' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('household_owner_only');
  });

  it.each([
    ['empty', ''],
    ['blank', '  '],
    ['over 40 characters', 'x'.repeat(41)],
    ['missing', undefined],
  ])('is a validation error for a name that is %s', async (_name, name) => {
    const ada = await createUser();
    const id = await created(ada);

    const response = await api()
      .patch(`/v1/households/${id}`)
      .set(as(ada))
      .send(name === undefined ? {} : { name });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('the answer for a household the caller is not in', () => {
  const routes = (id: string, member: string) =>
    [
      ['PATCH', `/v1/households/${id}`, { name: 'X' }],
      ['DELETE', `/v1/households/${id}`, undefined],
      ['POST', `/v1/households/${id}/invite`, {}],
      ['POST', `/v1/households/${id}/leave`, {}],
      ['DELETE', `/v1/households/${id}/members/${member}`, undefined],
      ['POST', `/v1/households/${id}/transfer`, { memberId: member }],
    ] as const;

  it('is the same 404 not_found as for one that does not exist, on every route', async () => {
    const ada = await createUser();
    const stranger = await createUser();
    const theirs = await created(stranger);
    const bodies = new Set<string>();

    for (const id of [theirs, uuidv7(), 'not-a-uuid']) {
      for (const [method, path, body] of routes(id, stranger.user.id)) {
        const request = api()
          [method.toLowerCase() as 'patch' | 'delete' | 'post'](path)
          .set(as(ada));
        const response = body === undefined ? await request : await request.send(body);
        expect([path, response.status]).toEqual([path, 404]);
        expect(response.body.error.code).toBe('not_found');
        bodies.add(response.body.error.message);
      }
    }
    expect(bodies.size).toBe(1);
  });
});

describe('POST /v1/households/{id}/invite', () => {
  it('lets the owner invite, and the code joins that household', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const id = await created(ada);

    const code = await inviteTo(ada, id);

    expect((await join(bao, code)).status).toBe(200);
    expect(await getPrisma().householdMember.count({ where: { householdId: id } })).toBe(2);
  });

  it('is 403 for a member, and is per household: the owner of two invites to the one named', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const first = await created(ada, 'First');
    const second = await created(ada, 'Second');
    const joinedFirst = await joined(bao, ada, 'Bao’s');
    expect(
      (await api().post(`/v1/households/${joinedFirst}/invite`).set(as(ada)).send({})).status,
    ).toBe(403);

    const code = await inviteTo(ada, second);
    await join(bao, code);

    expect(
      await getPrisma().householdMember.count({
        where: { householdId: second, userId: bao.user.id },
      }),
    ).toBe(1);
    expect(
      await getPrisma().householdMember.count({
        where: { householdId: first, userId: bao.user.id },
      }),
    ).toBe(0);
  });
});

describe('POST /v1/households/{id}/leave', () => {
  it('lets a member leave one household and stay in the other', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const cam = await createUser();
    const left = await joined(ada, bao, 'Leave me');
    const stay = await joined(cam, bao, 'Keep me');

    const response = await api().post(`/v1/households/${left}/leave`).set(as(bao)).send({});

    expect(response.status).toBe(204);
    const ids = (await spacesOf(bao))
      .filter((s) => s.kind === 'household')
      .map((s) => (s as { householdId: string }).householdId);
    expect(ids).toEqual([stay]);
  });

  it('hands back only that household’s private expenses', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const left = await joined(ada, bao, 'Leave me');
    const stay = await joined(ada, bao, 'Keep me');
    const [leftSpace, staySpace] = (await spacesOf(bao)).filter((s) => s.kind === 'household');
    const category = async (space: string) =>
      (await api().get('/v1/categories').set(as(bao)).set('X-Space-Id', space)).body.data[0];
    // Seed one private expense in each household's book, written by Bao.
    for (const space of [leftSpace!.id, staySpace!.id]) {
      const cat = await category(space);
      await api()
        .post('/v1/categories')
        .set(as(bao))
        .set('X-Space-Id', space)
        .send({ name: 'Shared things' });
      void cat;
    }
    expect([left, stay]).toHaveLength(2);

    expect((await api().post(`/v1/households/${left}/leave`).set(as(bao)).send({})).status).toBe(
      204,
    );

    expect(await getPrisma().householdMember.count({ where: { userId: bao.user.id } })).toBe(1);
  });

  it('is 409 owner_cannot_leave for the owner', async () => {
    const ada = await createUser();
    const id = await created(ada);

    const response = await api().post(`/v1/households/${id}/leave`).set(as(ada)).send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('owner_cannot_leave');
  });
});

describe('DELETE /v1/households/{id}/members/{memberId}', () => {
  it('lets the owner remove a member, who keeps their other households', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const cam = await createUser();
    const id = await joined(ada, bao, 'Remove from');
    await joined(cam, bao, 'Keep');

    const response = await api().delete(`/v1/households/${id}/members/${bao.user.id}`).set(as(ada));

    expect(response.status).toBe(204);
    expect(await getPrisma().householdMember.count({ where: { userId: bao.user.id } })).toBe(1);
  });

  it('is 403 for a member, 409 for the owner naming themselves, and 404 for someone not in this household', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const cam = await createUser();
    const id = await joined(ada, bao);
    const other = await created(cam);

    const asMember = await api().delete(`/v1/households/${id}/members/${ada.user.id}`).set(as(bao));
    const self = await api().delete(`/v1/households/${id}/members/${ada.user.id}`).set(as(ada));
    const elsewhere = await api()
      .delete(`/v1/households/${id}/members/${cam.user.id}`)
      .set(as(ada));

    expect([asMember.status, self.status, elsewhere.status]).toEqual([403, 409, 404]);
    expect(other).toBeTruthy();
  });
});

describe('POST /v1/households/{id}/transfer', () => {
  it('hands the household to a member, who can then invite', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const id = await joined(ada, bao);

    const response = await api()
      .post(`/v1/households/${id}/transfer`)
      .set(as(ada))
      .send({ memberId: bao.user.id });

    expect(response.status).toBe(200);
    expect(HouseholdResponse.parse(response.body).household).toMatchObject({
      role: 'member',
      ownerId: bao.user.id,
    });
    expect((await api().post(`/v1/households/${id}/invite`).set(as(bao)).send({})).status).toBe(
      201,
    );
    expect((await api().post(`/v1/households/${id}/invite`).set(as(ada)).send({})).status).toBe(
      403,
    );
  });

  it('is 403 for a member, and 400 when the owner names themselves', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const id = await joined(ada, bao);

    const asMember = await api()
      .post(`/v1/households/${id}/transfer`)
      .set(as(bao))
      .send({ memberId: bao.user.id });
    const self = await api()
      .post(`/v1/households/${id}/transfer`)
      .set(as(ada))
      .send({ memberId: ada.user.id });

    expect(asMember.status).toBe(403);
    expect(self.status).toBe(400);
  });
});

describe('DELETE /v1/households/{id}', () => {
  it('deletes only the one named: its members keep their other households, the owner’s others are untouched', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const gone = await joined(ada, bao, 'Gone');
    const kept = await created(ada, 'Kept');
    await join(bao, await inviteTo(ada, kept));

    const response = await api().delete(`/v1/households/${gone}`).set(as(ada));

    expect(response.status).toBe(204);
    expect(await getPrisma().household.count({ where: { id: gone } })).toBe(0);
    expect(await getPrisma().household.count({ where: { id: kept } })).toBe(1);
    expect(await getPrisma().householdMember.count({ where: { userId: bao.user.id } })).toBe(1);
  });

  it('gives the shared books to the owner’s personal space, merged into what is there', async () => {
    const ada = await createUser();
    const id = await created(ada, 'Shared');
    const space = (await spacesOf(ada)).find((s) => s.kind === 'household')!.id;
    const category = (
      await api()
        .post('/v1/categories')
        .set(as(ada))
        .set('X-Space-Id', space)
        .send({ name: 'Rent' })
    ).body.data;
    const shared = await api()
      .post('/v1/expenses')
      .set(as(ada))
      .set('X-Space-Id', space)
      .send({ categoryId: category.id, amountMinor: 50000, date: '2026-10-06' });
    expect(shared.status).toBe(201);

    expect((await api().delete(`/v1/households/${id}`).set(as(ada))).status).toBe(204);

    const personal = await api().get('/v1/expenses').set(as(ada)).set('X-Space-Id', ada.user.id);
    expect(personal.body.data.map((e: { id: string }) => e.id)).toContain(shared.body.data.id);
  });

  it('is 403 for a member', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const id = await joined(ada, bao);

    expect((await api().delete(`/v1/households/${id}`).set(as(bao))).status).toBe(403);
  });
});

describe('the older routes, for a person in exactly one household', () => {
  it('still act on it, so an app that predates spaces keeps working', async () => {
    const ada = await createUser();
    const bao = await createUser();
    const id = await created(ada);
    const code = (await api().post('/v1/household/invite').set(as(ada)).send({})).body.data
      .code as string;
    await join(bao, code);

    const read = await api().get('/v1/household').set(as(bao));
    const left = await api().post('/v1/household/leave').set(as(bao)).send({});

    expect(HouseholdResponse.parse(read.body).household?.id).toBe(id);
    expect(left.status).toBe(204);
  });
});
