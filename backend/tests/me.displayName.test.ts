import { MeResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { createUser, type TestUser } from './support/fixtures.ts';

/**
 * A display name: what other people in a household see instead of the first part of an email
 * address. Optional, not a credential (so no password is asked for), and cleared by sending null.
 */

async function setName(user: TestUser, displayName: unknown) {
  return await api().patch('/v1/me/profile').set('Authorization', user.auth).send({ displayName });
}

async function householdOfTwo(): Promise<{ owner: TestUser; member: TestUser }> {
  const owner = await createUser();
  const member = await createUser();
  await api().post('/v1/household').set('Authorization', owner.auth).send({});
  const invite = await api().post('/v1/household/invite').set('Authorization', owner.auth).send({});
  await api()
    .post('/v1/household/join')
    .set('Authorization', member.auth)
    .send({ code: invite.body.data.code });
  return { owner, member };
}

describe('PATCH /v1/me/profile', () => {
  it('has no display name until one is set', async () => {
    const user = await createUser();

    const me = await api().get('/v1/me').set('Authorization', user.auth);

    expect(MeResponse.parse(me.body).user.displayName).toBeNull();
  });

  it('sets the name, trimmed, and returns the updated user', async () => {
    const user = await createUser();

    const response = await setName(user, '  Ana Tran  ');

    expect(response.status).toBe(200);
    expect(MeResponse.parse(response.body).user.displayName).toBe('Ana Tran');
    const me = await api().get('/v1/me').set('Authorization', user.auth);
    expect(me.body.user.displayName).toBe('Ana Tran');
  });

  it('keeps accents and any language', async () => {
    const user = await createUser();

    const response = await setName(user, 'Trần Thị Mai');

    expect(response.status).toBe(200);
    expect(response.body.user.displayName).toBe('Trần Thị Mai');
  });

  it('clears the name when sent null, or blank', async () => {
    const user = await createUser();
    await setName(user, 'Ana');

    const cleared = await setName(user, null);
    expect(cleared.body.user.displayName).toBeNull();

    await setName(user, 'Ana');
    const blank = await setName(user, '   ');
    expect(blank.status).toBe(200);
    expect(blank.body.user.displayName).toBeNull();
  });

  it('refuses a name over 40 characters, and a wrong type', async () => {
    const user = await createUser();

    const long = await setName(user, 'x'.repeat(41));
    const wrong = await setName(user, 42);

    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe('validation_error');
    expect(wrong.status).toBe(400);
  });

  it('refuses a field it does not know, so an email cannot ride along', async () => {
    const user = await createUser();

    const response = await api()
      .patch('/v1/me/profile')
      .set('Authorization', user.auth)
      .send({ displayName: 'Ana', email: 'new@example.com' });

    expect(response.status).toBe(400);
  });

  it('requires a signed-in account', async () => {
    const response = await api().patch('/v1/me/profile').send({ displayName: 'Ana' });

    expect(response.status).toBe(401);
  });
});

describe('display names in a household', () => {
  it('are shown to the other members, null when a member has none', async () => {
    const { owner, member } = await householdOfTwo();
    await setName(owner, 'Ana');

    const household = await api().get('/v1/household').set('Authorization', member.auth);

    const members = household.body.household.members as Array<{
      userId: string;
      displayName: string | null;
    }>;
    expect(members.find((m) => m.userId === owner.user.id)?.displayName).toBe('Ana');
    expect(members.find((m) => m.userId === member.user.id)?.displayName).toBeNull();
  });

  it('ride on /v1/me with the household, so a phone can name authors offline', async () => {
    const { owner, member } = await householdOfTwo();
    await setName(member, 'Bao');

    const me = await api().get('/v1/me').set('Authorization', owner.auth);

    const entry = (
      me.body.household.members as Array<{ userId: string; displayName: string | null }>
    ).find((m) => m.userId === member.user.id);
    expect(entry?.displayName).toBe('Bao');
  });

  it("are the account holder's own: a member in a household still sees their own name on /v1/me", async () => {
    const { member } = await householdOfTwo();
    await setName(member, 'Bao');

    const me = await api().get('/v1/me').set('Authorization', member.auth);

    expect(me.body.user.displayName).toBe('Bao');
  });
});
