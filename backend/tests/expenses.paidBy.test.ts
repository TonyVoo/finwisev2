import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { clientId, createUser, type TestUser } from './support/fixtures.ts';
import { changeFor, pullAll, push, pushItem } from './support/sync.ts';

/**
 * Who paid for an expense (`docs/design/12-settle-up.md`).
 *
 * `paidBy` is nullable: null means "whoever added it", which is every expense that exists today.
 * When set it names a member of the household whose book holds the expense. It has no foreign key,
 * so a member leaving never costs the household its history, and it is validated only when it is
 * being set.
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

type Wire = { id: string; paidBy: string | null; createdBy: string | null; revision: number };

async function create(user: TestUser, body: Record<string, unknown> = {}) {
  const category = await categoryOf(user);
  return api()
    .post('/v1/expenses')
    .set('Authorization', user.auth)
    .send({ categoryId: category.id, amountMinor: 1234, date: '2026-10-06', ...body });
}

async function add(user: TestUser, body: Record<string, unknown> = {}): Promise<Wire> {
  const response = await create(user, body);
  expect(response.status).toBe(201);
  return response.body.data as Wire;
}

const patch = (user: TestUser, id: string, body: Record<string, unknown>) =>
  api().patch(`/v1/expenses/${id}`).set('Authorization', user.auth).send(body);

describe('creating', () => {
  it('has no payer unless one is given: the person who added it paid', async () => {
    const { owner } = await householdOfTwo();

    const expense = await add(owner);

    expect(expense.paidBy).toBeNull();
  });

  it('records a member as the payer, and everyone sees it', async () => {
    const { owner, member } = await householdOfTwo();

    const expense = await add(owner, { paidBy: member.user.id });

    expect(expense.paidBy).toBe(member.user.id);
    expect(expense.createdBy).toBe(owner.user.id);
    const listed = await api().get('/v1/expenses').set('Authorization', member.auth);
    expect((listed.body.data as Wire[]).find((e) => e.id === expense.id)?.paidBy).toBe(
      member.user.id,
    );
  });

  it('accepts an explicit null', async () => {
    const { owner } = await householdOfTwo();

    expect((await add(owner, { paidBy: null })).paidBy).toBeNull();
  });

  it('refuses someone who is not in the household, naming the field', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();

    const response = await create(owner, { paidBy: stranger.user.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details.issues[0].path).toBe('paidBy');
  });

  it('refuses an id that belongs to no one', async () => {
    const { owner } = await householdOfTwo();

    expect((await create(owner, { paidBy: randomUUID() })).status).toBe(400);
  });

  it('lets a solo account name only itself', async () => {
    const solo = await createUser();
    const other = await createUser();

    expect((await add(solo, { paidBy: solo.user.id })).paidBy).toBe(solo.user.id);
    expect((await create(solo, { paidBy: other.user.id })).status).toBe(400);
  });
});

describe('changing', () => {
  it('lets any member change who paid, not only the author', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner);

    const response = await patch(member, expense.id, { paidBy: member.user.id });

    expect(response.status).toBe(200);
    expect(response.body.data.paidBy).toBe(member.user.id);
    expect(response.body.data.createdBy).toBe(owner.user.id);
  });

  it('clears the payer with null', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner, { paidBy: member.user.id });

    const response = await patch(owner, expense.id, { paidBy: null });

    expect(response.body.data.paidBy).toBeNull();
  });

  it('leaves the payer alone when other fields change', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner, { paidBy: member.user.id });

    const response = await patch(owner, expense.id, { amountMinor: 999 });

    expect(response.body.data.paidBy).toBe(member.user.id);
  });

  it('refuses a payer outside the household', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();
    const expense = await add(owner);

    const response = await patch(owner, expense.id, { paidBy: stranger.user.id });

    expect(response.status).toBe(400);
    expect(response.body.error.details.issues[0].path).toBe('paidBy');
  });

  it('bumps the revision, so other phones pick the change up', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner);

    const response = await patch(owner, expense.id, { paidBy: member.user.id });

    expect(response.body.data.revision).toBeGreaterThan(expense.revision);
  });
});

describe('when someone leaves', () => {
  it('keeps the payer on existing expenses, and still lets other fields be edited', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner, { paidBy: member.user.id });
    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    const edited = await patch(owner, expense.id, { amountMinor: 555 });

    expect(row.paidBy).toBe(member.user.id);
    expect(edited.status).toBe(200);
    expect(edited.body.data.paidBy).toBe(member.user.id);
  });

  it('refuses to name the person who left as the payer', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner);
    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    const response = await patch(owner, expense.id, { paidBy: member.user.id });

    expect(response.status).toBe(400);
  });
});

describe('private expenses', () => {
  it('never reveal who paid to anyone but the author', async () => {
    const { owner, member } = await householdOfTwo();
    const secret = await add(member, { private: true, paidBy: owner.user.id });

    const { changes } = await pullAll(owner);
    const seen = changeFor(changes, secret.id)?.record as Record<string, unknown>;

    expect(seen.deletedAt).not.toBeNull();
    expect(seen.paidBy).toBeNull();
    const own = changeFor((await pullAll(member)).changes, secret.id)?.record as Record<
      string,
      unknown
    >;
    expect(own.paidBy).toBe(owner.user.id);
  });
});

describe('sync', () => {
  it('pulls the payer', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner, { paidBy: member.user.id });

    const seen = changeFor((await pullAll(member)).changes, expense.id)?.record as Record<
      string,
      unknown
    >;

    expect(seen.paidBy).toBe(member.user.id);
  });

  it('creates an expense with a payer from a push', async () => {
    const { owner, member } = await householdOfTwo();
    const category = await categoryOf(owner);
    const id = clientId();

    const outcome = await push(owner, [
      pushItem({
        entity: 'expense',
        id,
        fields: {
          categoryId: category.id,
          amountMinor: 500,
          date: '2026-10-09',
          paidBy: member.user.id,
        },
      } as never),
    ]);

    expect(outcome.body.results[0]).toMatchObject({ status: 'applied' });
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id } });
    expect(row.paidBy).toBe(member.user.id);
  });

  it('refuses a push naming someone outside the household, as an invalid record', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();
    const category = await categoryOf(owner);
    const id = clientId();

    const outcome = await push(owner, [
      pushItem({
        entity: 'expense',
        id,
        fields: {
          categoryId: category.id,
          amountMinor: 500,
          date: '2026-10-09',
          paidBy: stranger.user.id,
        },
      } as never),
    ]);

    expect(outcome.status).toBe(200);
    expect(outcome.body.results[0]).toMatchObject({ status: 'invalid' });
    expect(await getPrisma().expense.findUnique({ where: { id } })).toBeNull();
  });

  it('changes the payer of an existing expense from a push', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await add(owner);

    const outcome = await push(member, [
      pushItem({
        entity: 'expense',
        id: expense.id,
        fields: { paidBy: member.user.id },
      } as never),
    ]);

    expect(outcome.body.results[0]).toMatchObject({ status: 'applied' });
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.paidBy).toBe(member.user.id);
  });

  it('refuses a push that names a stranger as the payer of an existing expense', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();
    const expense = await add(owner);

    const outcome = await push(owner, [
      pushItem({
        entity: 'expense',
        id: expense.id,
        fields: { paidBy: stranger.user.id },
      } as never),
    ]);

    expect(outcome.body.results[0]).toMatchObject({ status: 'invalid' });
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.paidBy).toBeNull();
  });
});
