import {
  HouseholdInviteResponse,
  HouseholdResponse,
  INVITE_CODE_ALPHABET,
  LIMITS,
} from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';

/**
 * Shared households (`docs/design/10-households.md`), over HTTP.
 *
 * The idea under test: a household reuses the **owner's** id as the data scope. A member's
 * identity (their token) never changes, but the rows they read and write become the owner's;
 * their own rows stay where they are and reappear when they leave.
 */

async function createHousehold(owner: TestUser) {
  return await api().post('/v1/household').set('Authorization', owner.auth).send({});
}

async function invite(owner: TestUser): Promise<string> {
  const response = await api()
    .post('/v1/household/invite')
    .set('Authorization', owner.auth)
    .send({});
  expect(response.status).toBe(201);
  return (response.body as HouseholdInviteResponse).data.code;
}

async function join(member: TestUser, code: string) {
  return await api().post('/v1/household/join').set('Authorization', member.auth).send({ code });
}

/** An owner with a household and one member who has joined it. */
async function householdOfTwo(): Promise<{ owner: TestUser; member: TestUser }> {
  const owner = await createUser({ currency: 'USD' });
  const member = await createUser({ currency: 'EUR' });
  expect((await createHousehold(owner)).status).toBe(201);
  expect((await join(member, await invite(owner))).status).toBe(200);
  return { owner, member };
}

async function expensesOf(user: TestUser): Promise<string[]> {
  const response = await api().get('/v1/expenses').set('Authorization', user.auth);
  expect(response.status).toBe(200);
  return (response.body.data as Array<{ id: string }>).map((e) => e.id);
}

describe('GET /v1/household', () => {
  it('is null for a person in no household', async () => {
    const user = await createUser();

    const response = await api().get('/v1/household').set('Authorization', user.auth);

    expect(response.status).toBe(200);
    expect(HouseholdResponse.parse(response.body).household).toBeNull();
  });
});

describe('POST /v1/household', () => {
  it('makes the caller the owner, and the only member', async () => {
    const owner = await createUser({ currency: 'EUR' });

    const response = await createHousehold(owner);

    expect(response.status).toBe(201);
    const { household } = HouseholdResponse.parse(response.body);
    expect(household).toMatchObject({
      role: 'owner',
      ownerId: owner.user.id,
      currency: 'EUR',
    });
    expect(household?.members).toEqual([
      expect.objectContaining({ userId: owner.user.id, email: owner.user.email, role: 'owner' }),
    ]);
  });

  it('moves nothing: the creator keeps seeing their own books', async () => {
    const owner = await createUser();
    const expense = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    await createHousehold(owner);

    expect(await expensesOf(owner)).toEqual([expense.id]);
  });

  it('is 409 household_exists when the caller is already in one', async () => {
    const owner = await createUser();
    await createHousehold(owner);

    const again = await createHousehold(owner);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('household_exists');
  });
});

describe('POST /v1/household/invite', () => {
  it('returns an 8-character code from the unambiguous alphabet, valid for 48 hours', async () => {
    const owner = await createUser();
    await createHousehold(owner);
    const before = Date.now();

    const response = await api()
      .post('/v1/household/invite')
      .set('Authorization', owner.auth)
      .send({});

    expect(response.status).toBe(201);
    const { code, expiresAt } = HouseholdInviteResponse.parse(response.body).data;
    expect(code).toHaveLength(LIMITS.INVITE_CODE_LENGTH);
    for (const char of code) expect(INVITE_CODE_ALPHABET).toContain(char);
    const ttlHours = (new Date(expiresAt).getTime() - before) / 3_600_000;
    expect(ttlHours).toBeGreaterThan(47.9);
    expect(ttlHours).toBeLessThan(48.1);
  });

  it('stores only a hash of the code', async () => {
    const owner = await createUser();
    await createHousehold(owner);
    const code = await invite(owner);

    const rows = await getPrisma().householdInvite.findMany();

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('replaces the earlier code when asked again', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    await createHousehold(owner);
    const first = await invite(owner);
    await invite(owner);

    const response = await join(joiner, first);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_invite_code');
  });

  it('is 404 not_in_household for a person with no household', async () => {
    const user = await createUser();

    const response = await api()
      .post('/v1/household/invite')
      .set('Authorization', user.auth)
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_in_household');
  });

  it('is 403 household_owner_only for a member', async () => {
    const { member } = await householdOfTwo();

    const response = await api()
      .post('/v1/household/invite')
      .set('Authorization', member.auth)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('household_owner_only');
  });
});

describe('POST /v1/household/join', () => {
  it('adds the caller as a member, and shows them the household in the owner currency', async () => {
    const owner = await createUser({ currency: 'USD' });
    const joiner = await createUser({ currency: 'EUR' });
    await createHousehold(owner);

    const response = await join(joiner, await invite(owner));

    expect(response.status).toBe(200);
    const { household } = HouseholdResponse.parse(response.body);
    expect(household).toMatchObject({ role: 'member', ownerId: owner.user.id, currency: 'USD' });
    expect(household?.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
  });

  it('takes the code in any case, with surrounding space', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    await createHousehold(owner);
    const code = await invite(owner);

    const response = await join(joiner, `  ${code.toLowerCase()} `);

    expect(response.status).toBe(200);
  });

  it('works once: a second person with the same code is refused', async () => {
    const owner = await createUser();
    const [first, second] = await Promise.all([createUser(), createUser()]);
    await createHousehold(owner);
    const code = await invite(owner);

    expect((await join(first, code)).status).toBe(200);
    const late = await join(second, code);

    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('invalid_invite_code');
  });

  it('refuses a wrong code and an expired one with the same answer', async () => {
    const owner = await createUser();
    const joiner = await createUser();
    await createHousehold(owner);
    const code = await invite(owner);
    await getPrisma().householdInvite.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await join(joiner, code);
    const wrong = await join(joiner, 'AAAAAAAA');

    expect(expired.status).toBe(400);
    expect(wrong.status).toBe(400);
    expect(expired.body.error).toEqual(wrong.body.error);
  });

  it('is 409 household_exists when the caller is already in one', async () => {
    const owner = await createUser();
    const other = await createUser();
    await createHousehold(owner);
    await createHousehold(other);

    const response = await join(other, await invite(owner));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('household_exists');
  });

  it('is rate limited per account, whatever the outcome', async () => {
    const joiner = await createUser();

    for (let attempt = 0; attempt < LIMITS.INVITE_JOIN_MAX_PER_USER; attempt += 1) {
      expect((await join(joiner, 'AAAAAAAA')).status).toBe(400);
    }
    const blocked = await join(joiner, 'AAAAAAAA');

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('rejects a malformed code as a validation error', async () => {
    const joiner = await createUser();

    const response = await join(joiner, 'abc');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('the shared data scope', () => {
  it('shows a member the owner books, and the owner what the member adds', async () => {
    const owner = await createUser();
    const ownerExpense = await createExpense(owner, { categoryId: owner.defaultCategory.id });
    const member = await createUser();
    await createHousehold(owner);
    await join(member, await invite(owner));

    expect(await expensesOf(member)).toEqual([ownerExpense.id]);

    const memberExpense = await createExpense(member, { categoryId: owner.defaultCategory.id });
    expect((await expensesOf(owner)).sort()).toEqual([ownerExpense.id, memberExpense.id].sort());
  });

  it("hides a member's own earlier books while they are in, and brings them back on leaving", async () => {
    const owner = await createUser();
    const member = await createUser();
    const private1 = await createExpense(member, { categoryId: member.defaultCategory.id });
    await createHousehold(owner);
    await join(member, await invite(owner));

    expect(await expensesOf(member)).not.toContain(private1.id);

    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    expect(await expensesOf(member)).toEqual([private1.id]);
  });

  it('serves the owner stream through /v1/sync to a member', async () => {
    const owner = await createUser();
    const expense = await createExpense(owner, { categoryId: owner.defaultCategory.id });
    const member = await createUser();
    await createHousehold(owner);
    await join(member, await invite(owner));

    const pull = await api().get('/v1/sync').query({ since: 0 }).set('Authorization', member.auth);

    expect(pull.status).toBe(200);
    const ids = (pull.body.changes as Array<{ record: { id: string } }>).map((c) => c.record.id);
    expect(ids).toContain(expense.id);
  });

  it('lets a member push changes, which the owner then pulls', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await createExpense(member, { categoryId: owner.defaultCategory.id });

    const pull = await api().get('/v1/sync').query({ since: 0 }).set('Authorization', owner.auth);

    const ids = (pull.body.changes as Array<{ record: { id: string } }>).map((c) => c.record.id);
    expect(ids).toContain(expense.id);
  });

  it('reports the data owner and the household currency on /v1/me', async () => {
    const { owner, member } = await householdOfTwo();

    const asMember = await api().get('/v1/me').set('Authorization', member.auth);
    const asOwner = await api().get('/v1/me').set('Authorization', owner.auth);

    expect(asMember.body.user.id).toBe(member.user.id);
    // Both work in the household's book, which is nobody's own account.
    expect(asMember.body.dataOwnerId).toBe(asOwner.body.dataOwnerId);
    expect(asMember.body.dataOwnerId).not.toBe(member.user.id);
    expect(asMember.body.dataOwnerId).not.toBe(owner.user.id);
    expect(asMember.body.user.currency).toBe('USD');
  });

  it('carries the household, with who is in it, on /v1/me for the app to label rows', async () => {
    const { owner, member } = await householdOfTwo();

    const asMember = await api().get('/v1/me').set('Authorization', member.auth);
    const asOwner = await api().get('/v1/me').set('Authorization', owner.auth);

    for (const body of [asMember.body, asOwner.body]) {
      expect(body.household.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
        [owner.user.id, member.user.id].sort(),
      );
    }
    expect(asMember.body.household.role).toBe('member');
    expect(asOwner.body.household.role).toBe('owner');
  });

  it('has no household on /v1/me for a person in none', async () => {
    const user = await createUser();

    const me = await api().get('/v1/me').set('Authorization', user.auth);

    expect(me.body.household).toBeNull();
  });

  it('reports a plain account as its own data owner, in its own currency', async () => {
    const user = await createUser({ currency: 'EUR' });

    const me = await api().get('/v1/me').set('Authorization', user.auth);

    expect(me.body.dataOwnerId).toBe(user.user.id);
    expect(me.body.user.currency).toBe('EUR');
  });
});

describe('POST /v1/household/leave', () => {
  it('returns a member to their own books', async () => {
    const { member } = await householdOfTwo();

    const response = await api()
      .post('/v1/household/leave')
      .set('Authorization', member.auth)
      .send({});

    expect(response.status).toBe(204);
    const me = await api().get('/v1/me').set('Authorization', member.auth);
    expect(me.body.dataOwnerId).toBe(member.user.id);
    expect(me.body.user.currency).toBe('EUR');
    const household = await api().get('/v1/household').set('Authorization', member.auth);
    expect(household.body.household).toBeNull();
  });

  it('is 409 owner_cannot_leave for the owner', async () => {
    const { owner } = await householdOfTwo();

    const response = await api()
      .post('/v1/household/leave')
      .set('Authorization', owner.auth)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('owner_cannot_leave');
  });

  it('is 404 not_in_household for a person in none', async () => {
    const user = await createUser();

    const response = await api()
      .post('/v1/household/leave')
      .set('Authorization', user.auth)
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_in_household');
  });
});

describe('DELETE /v1/household/members/{userId}', () => {
  it('lets the owner remove a member, who goes back to their own books', async () => {
    const { owner, member } = await householdOfTwo();

    const response = await api()
      .delete(`/v1/household/members/${member.user.id}`)
      .set('Authorization', owner.auth);

    expect(response.status).toBe(204);
    const me = await api().get('/v1/me').set('Authorization', member.auth);
    expect(me.body.dataOwnerId).toBe(member.user.id);
    const household = await api().get('/v1/household').set('Authorization', owner.auth);
    expect(household.body.household.members).toHaveLength(1);
  });

  it('is 403 household_owner_only for a member', async () => {
    const { owner, member } = await householdOfTwo();

    const response = await api()
      .delete(`/v1/household/members/${owner.user.id}`)
      .set('Authorization', member.auth);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('household_owner_only');
  });

  it('is 409 owner_cannot_leave when the owner names themselves', async () => {
    const { owner } = await householdOfTwo();

    const response = await api()
      .delete(`/v1/household/members/${owner.user.id}`)
      .set('Authorization', owner.auth);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('owner_cannot_leave');
  });

  it('is 404 for a person who is not a member of the caller household', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();

    const response = await api()
      .delete(`/v1/household/members/${stranger.user.id}`)
      .set('Authorization', owner.auth);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});

describe('DELETE /v1/household', () => {
  it('dissolves it: every member returns to their own books, the owner keeps the shared ones', async () => {
    const { owner, member } = await householdOfTwo();
    const shared = await createExpense(member, { categoryId: owner.defaultCategory.id });

    const response = await api().delete('/v1/household').set('Authorization', owner.auth);

    expect(response.status).toBe(204);
    const me = await api().get('/v1/me').set('Authorization', member.auth);
    expect(me.body.dataOwnerId).toBe(member.user.id);
    expect(await expensesOf(owner)).toContain(shared.id);
    expect(await expensesOf(member)).not.toContain(shared.id);
    expect(await getPrisma().householdInvite.count()).toBe(0);
  });

  it('is 403 household_owner_only for a member, and 404 for a person in none', async () => {
    const { member } = await householdOfTwo();
    const stranger = await createUser();

    const asMember = await api().delete('/v1/household').set('Authorization', member.auth);
    const asStranger = await api().delete('/v1/household').set('Authorization', stranger.auth);

    expect(asMember.status).toBe(403);
    expect(asMember.body.error.code).toBe('household_owner_only');
    expect(asStranger.status).toBe(404);
    expect(asStranger.body.error.code).toBe('not_in_household');
  });
});

describe('DELETE /v1/me and households', () => {
  it('is 409 household_has_members for an owner whose household has others', async () => {
    const { owner } = await householdOfTwo();

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', owner.auth)
      .send({ password: owner.password });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('household_has_members');
  });

  it('lets an owner delete their account once the household is gone, or when they are alone', async () => {
    const lone = await createUser();
    await createHousehold(lone);

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', lone.auth)
      .send({ password: lone.password });

    expect(response.status).toBe(204);
    expect(await getPrisma().household.count()).toBe(0);
  });

  it('ends only the membership when a member deletes their account', async () => {
    const { owner, member } = await householdOfTwo();

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', member.auth)
      .send({ password: member.password });

    expect(response.status).toBe(204);
    const household = await api().get('/v1/household').set('Authorization', owner.auth);
    expect(household.body.household.members).toHaveLength(1);
  });
});
