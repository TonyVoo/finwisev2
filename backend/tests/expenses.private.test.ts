import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { clientId, createUser, type TestUser } from './support/fixtures.ts';
import { changeFor, pullAll, push, pushItem } from './support/sync.ts';

/**
 * Private expenses (`docs/design/10-households.md`, "Private expenses").
 *
 * An expense marked private is stored in the household's book but only its author sees it. To
 * everyone else it arrives as a **deleted placeholder** - same id and revision, no content - which
 * is what lets one mechanism hide it, drop it from phones that already had it when it is made
 * private later, and bring it back if it is made shared again.
 */

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

async function categoryOf(user: TestUser, name = 'Groceries') {
  const list = await api().get('/v1/categories').set('Authorization', user.auth);
  return (list.body.data as Array<{ id: string; name: string }>).find((c) => c.name === name)!;
}

async function add(user: TestUser, body: Record<string, unknown> = {}) {
  const category = await categoryOf(user);
  const response = await api()
    .post('/v1/expenses')
    .set('Authorization', user.auth)
    .send({ categoryId: category.id, amountMinor: 1234, date: '2026-10-06', ...body });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; private: boolean; revision: number };
}

async function idsOf(user: TestUser): Promise<string[]> {
  const response = await api().get('/v1/expenses').set('Authorization', user.auth);
  expect(response.status).toBe(200);
  return (response.body.data as Array<{ id: string }>).map((e) => e.id);
}

describe('creating and listing', () => {
  it('defaults to shared, and says so on the wire', async () => {
    const { owner, member } = await householdOfTwo();

    const expense = await add(owner);

    expect(expense.private).toBe(false);
    expect(await idsOf(member)).toContain(expense.id);
  });

  it('is visible to its author, and to nobody else in the household', async () => {
    const { owner, member } = await householdOfTwo();

    const secret = await add(member, { private: true, note: 'surprise gift' });

    expect(secret.private).toBe(true);
    expect(await idsOf(member)).toContain(secret.id);
    expect(await idsOf(owner)).not.toContain(secret.id);
  });

  it('does not reveal a private expense to a member who asks for it by date or category', async () => {
    const { owner, member } = await householdOfTwo();
    await add(member, { private: true });
    const category = await categoryOf(owner);

    const byDate = await api()
      .get('/v1/expenses')
      .query({ from: '2026-10-01', to: '2026-10-31', categoryId: category.id })
      .set('Authorization', owner.auth);

    expect(byDate.body.data).toHaveLength(0);
  });
});

describe('changing and deleting', () => {
  it('lets the author edit and delete their own private expense', async () => {
    const { member } = await householdOfTwo();
    const secret = await add(member, { private: true });

    const edited = await api()
      .patch(`/v1/expenses/${secret.id}`)
      .set('Authorization', member.auth)
      .send({ amountMinor: 999 });
    const removed = await api()
      .delete(`/v1/expenses/${secret.id}`)
      .set('Authorization', member.auth);

    expect(edited.status).toBe(200);
    expect(edited.body.data.amountMinor).toBe(999);
    expect(removed.status).toBe(200);
  });

  it('treats a private expense of someone else as if it did not exist', async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true });

    const patch = await api()
      .patch(`/v1/expenses/${secret.id}`)
      .set('Authorization', owner.auth)
      .send({ amountMinor: 1 });
    const del = await api().delete(`/v1/expenses/${secret.id}`).set('Authorization', owner.auth);

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: secret.id } });
    expect(row.deletedAt).toBeNull();
    expect(Number(row.amountMinor)).toBe(1234);
  });

  it('lets the author make an expense private, and shared again', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(member);
    expect(await idsOf(owner)).toContain(expense.id);

    const hidden = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', member.auth)
      .send({ private: true });
    expect(hidden.body.data.private).toBe(true);
    expect(await idsOf(owner)).not.toContain(expense.id);

    await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', member.auth)
      .send({ private: false });
    expect(await idsOf(owner)).toContain(expense.id);
  });

  it('refuses to let someone else change whether an expense is private', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(member);

    const response = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', owner.auth)
      .send({ private: true });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.private).toBe(false);
  });

  it('still lets another member edit the other fields of a shared expense', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(member);

    const response = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', owner.auth)
      .send({ amountMinor: 4321 });

    expect(response.status).toBe(200);
    expect(response.body.data.private).toBe(false);
  });
});

describe('sync', () => {
  it('sends everyone else a deleted placeholder with no content, at the same revision', async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true, note: 'surprise gift', amountMinor: 7777 });

    const { changes } = await pullAll(owner);
    const seen = changeFor(changes, secret.id)?.record as Record<string, unknown>;

    expect(seen).toBeDefined();
    expect(seen.deletedAt).not.toBeNull();
    expect(seen.amountMinor).toBe(0);
    expect(seen.note).toBeNull();
    expect(seen.createdBy).toBeNull();
    expect(seen.private).toBe(true);
    expect(seen.revision).toBe(secret.revision);
    expect(JSON.stringify(seen)).not.toContain('surprise');
    expect(JSON.stringify(seen)).not.toContain('7777');
  });

  it('sends the author the real row', async () => {
    const { member } = await householdOfTwo();
    const secret = await add(member, { private: true, note: 'surprise gift', amountMinor: 7777 });

    const { changes } = await pullAll(member);
    const seen = changeFor(changes, secret.id)?.record as Record<string, unknown>;

    expect(seen.deletedAt).toBeNull();
    expect(seen.amountMinor).toBe(7777);
    expect(seen.note).toBe('surprise gift');
    expect(seen.private).toBe(true);
  });

  it('tells a phone that already had an expense to drop it when it is made private', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(member);
    const first = await pullAll(owner);
    expect(
      (changeFor(first.changes, expense.id)?.record as { deletedAt: unknown }).deletedAt,
    ).toBeNull();

    await api().patch(`/v1/expenses/${expense.id}`).set('Authorization', owner.auth).send({});
    await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', member.auth)
      .send({ private: true });
    const next = await pullAll(owner, { from: first.cursor });

    const seen = changeFor(next.changes, expense.id)?.record as Record<string, unknown>;
    expect(seen.deletedAt).not.toBeNull();
    expect(seen.amountMinor).toBe(0);
  });

  it('brings it back to everyone when it is made shared again', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(member, { private: true, note: 'gift' });
    const first = await pullAll(owner);

    await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', member.auth)
      .send({ private: false });
    const next = await pullAll(owner, { from: first.cursor });

    const seen = changeFor(next.changes, expense.id)?.record as Record<string, unknown>;
    expect(seen.deletedAt).toBeNull();
    expect(seen.note).toBe('gift');
  });

  it('creates a private expense from a push, and hides it from the others', async () => {
    const { owner, member } = await householdOfTwo();
    const category = await categoryOf(member);
    const id = clientId();

    const outcome = await push(member, [
      pushItem({
        entity: 'expense',
        id,
        fields: { categoryId: category.id, amountMinor: 500, date: '2026-10-09', private: true },
      } as never),
    ]);

    expect(outcome.status).toBe(200);
    expect(outcome.body.results[0]).toMatchObject({ status: 'applied' });
    const seenByOwner = changeFor((await pullAll(owner)).changes, id)?.record as {
      deletedAt: unknown;
    };
    expect(seenByOwner.deletedAt).not.toBeNull();
  });

  it("refuses a push that edits someone else's private expense, without leaking it", async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true, note: 'surprise gift', amountMinor: 7777 });

    const outcome = await push(owner, [
      pushItem({ entity: 'expense', id: secret.id, fields: { amountMinor: 1 } } as never),
    ]);

    expect(outcome.status).toBe(200);
    const result = outcome.body.results[0]!;
    expect(result.status).toBe('invalid');
    expect(JSON.stringify(result)).not.toContain('surprise');
    expect(JSON.stringify(result)).not.toContain('7777');
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: secret.id } });
    expect(Number(row.amountMinor)).toBe(7777);
  });

  it("refuses a push that makes someone else's shared expense private", async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(member);

    const outcome = await push(owner, [
      pushItem({ entity: 'expense', id: expense.id, fields: { private: true } } as never),
    ]);

    expect(outcome.body.results[0]).toMatchObject({ status: 'invalid' });
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.private).toBe(false);
  });
});

describe('receipts', () => {
  it('do not follow a private expense to other members', async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true });
    const bytes = Buffer.alloc(64, 7);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    const put = await api()
      .put(`/v1/expenses/${secret.id}/receipt`)
      .set('Authorization', member.auth)
      .send({ contentType: 'image/jpeg', dataBase64: bytes.toString('base64') });
    expect(put.status).toBe(200);

    const get = await api()
      .get(`/v1/expenses/${secret.id}/receipt`)
      .set('Authorization', owner.auth);
    const index = await api().get('/v1/receipts').set('Authorization', owner.auth);

    expect(get.status).toBe(404);
    expect(JSON.stringify(index.body)).not.toContain(secret.id);
  });
});

describe('leaving takes private expenses along', () => {
  it("moves a leaving member's private expenses to their own books, and leaves the shared ones", async () => {
    const { owner, member } = await householdOfTwo();
    const shared = await add(member, { note: 'shared' });
    const secret = await add(member, { private: true, note: 'mine' });

    const left = await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    expect(left.status).toBe(204);
    const mine = await idsOf(member);
    expect(mine).toContain(secret.id);
    expect(mine).not.toContain(shared.id);
    expect(await idsOf(owner)).toContain(shared.id);
    expect(await idsOf(owner)).not.toContain(secret.id);
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: secret.id } });
    expect(row.userId).toBe(member.user.id);
    expect(row.private).toBe(false);
    // It sits in a category of their own, not one of the household's.
    const category = await getPrisma().category.findUniqueOrThrow({
      where: { id: row.categoryId },
    });
    expect(category.userId).toBe(member.user.id);
  });

  it('files it under the same-named category of their own, or Uncategorized', async () => {
    const { member } = await householdOfTwo();
    const groceries = await add(member, { private: true });
    const catList = await api().get('/v1/categories').set('Authorization', member.auth);
    const pets = await api()
      .post('/v1/categories')
      .set('Authorization', member.auth)
      .send({ name: 'HouseholdOnlyCategory' });
    const odd = await api()
      .post('/v1/expenses')
      .set('Authorization', member.auth)
      .send({ categoryId: pets.body.data.id, amountMinor: 5, date: '2026-10-06', private: true });
    void catList;

    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    const g = await getPrisma().expense.findUniqueOrThrow({ where: { id: groceries.id } });
    const o = await getPrisma().expense.findUniqueOrThrow({ where: { id: odd.body.data.id } });
    const gCat = await getPrisma().category.findUniqueOrThrow({ where: { id: g.categoryId } });
    const oCat = await getPrisma().category.findUniqueOrThrow({ where: { id: o.categoryId } });
    expect(gCat.name).toBe('Groceries');
    expect(oCat.isDefault).toBe(true);
  });

  it('does the same when the owner removes them', async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true });

    await api().delete(`/v1/household/members/${member.user.id}`).set('Authorization', owner.auth);

    expect(await idsOf(member)).toContain(secret.id);
    expect(await idsOf(owner)).not.toContain(secret.id);
  });

  it('hands every member their own private expenses when the household is deleted', async () => {
    const { owner, member } = await householdOfTwo();
    const ownerSecret = await add(owner, { private: true });
    const memberSecret = await add(member, { private: true });
    const shared = await add(member);

    const response = await api().delete('/v1/household').set('Authorization', owner.auth);

    expect(response.status).toBe(204);
    const ownerIds = await idsOf(owner);
    const memberIds = await idsOf(member);
    expect(ownerIds).toContain(ownerSecret.id);
    expect(ownerIds).toContain(shared.id);
    expect(ownerIds).not.toContain(memberSecret.id);
    expect(memberIds).toEqual([memberSecret.id]);
  });

  it("deletes a member's private expenses when they delete their account, rather than orphaning them", async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true });
    const shared = await add(member);

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', member.auth)
      .send({ password: member.password });

    expect(response.status).toBe(204);
    expect(await getPrisma().expense.findUnique({ where: { id: secret.id } })).toBeNull();
    expect(await idsOf(owner)).toContain(shared.id);
  });
});
