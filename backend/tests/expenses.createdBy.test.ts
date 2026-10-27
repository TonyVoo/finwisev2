import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { clientId, createExpense, createUser, type TestUser } from './support/fixtures.ts';
import { changeFor, pullAll, push, pushItem } from './support/sync.ts';

/**
 * Who added an expense (`docs/design/10-households.md`, "Added by").
 *
 * `createdBy` is the **actor**: the account that made the request, not whose books the row
 * landed in. In a household those differ, which is the whole point. It is server-assigned,
 * immutable, and nulled (not cascaded) if that account is deleted, so a member leaving never
 * costs the household its history.
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

describe('expenses.createdBy', () => {
  it('is the account that created the expense, and is on the wire', async () => {
    const user = await createUser();

    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });

    expect(expense.createdBy).toBe(user.user.id);
    const list = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(list.body.data[0].createdBy).toBe(user.user.id);
  });

  it('is the member, not the owner, when a member adds to the shared books', async () => {
    const { owner, member } = await householdOfTwo();

    const expense = await createExpense(member, { categoryId: owner.defaultCategory.id });

    expect(expense.createdBy).toBe(member.user.id);
    // The row lives in the household's book: neither person's own account.
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.userId).not.toBe(owner.user.id);
    expect(row.userId).not.toBe(member.user.id);
    const scope = (await api().get('/v1/me').set('Authorization', owner.auth)).body.dataOwnerId;
    expect(row.userId).toBe(scope);
  });

  it('is the member when they create through sync, and the owner sees it on pull', async () => {
    const { owner, member } = await householdOfTwo();
    const id = clientId();

    const outcome = await push(member, [
      pushItem({
        entity: 'expense',
        id,
        fields: { categoryId: owner.defaultCategory.id, amountMinor: 500, date: '2026-10-09' },
      } as never),
    ]);
    expect(outcome.status).toBe(200);

    const { changes } = await pullAll(owner);
    expect(changeFor(changes, id)?.record).toMatchObject({ createdBy: member.user.id });
  });

  it('does not change when someone else edits the expense', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    const edited = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', member.auth)
      .send({ amountMinor: 999 });

    expect(edited.status).toBe(200);
    expect(edited.body.data.createdBy).toBe(owner.user.id);
  });

  it('cannot be set by the client over REST', async () => {
    const user = await createUser();

    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.defaultCategory.id,
      amountMinor: 100,
      date: '2026-10-09',
      createdBy: user.user.id,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('cannot be set by the client through sync: it is an immutable field', async () => {
    const user = await createUser();

    const outcome = await push(user, [
      pushItem({
        entity: 'expense',
        id: clientId(),
        fields: {
          categoryId: user.defaultCategory.id,
          amountMinor: 100,
          date: '2026-10-09',
          createdBy: user.user.id,
        },
      } as never),
    ]);

    expect(outcome.body.results[0]).toMatchObject({
      status: 'invalid',
      error: { code: 'immutable_field' },
    });
  });

  it('becomes null, and the expense stays, when the account that added it is deleted', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await createExpense(member, { categoryId: owner.defaultCategory.id });

    const deleted = await api()
      .delete('/v1/me')
      .set('Authorization', member.auth)
      .send({ password: member.password });
    expect(deleted.status).toBe(204);

    const list = await api().get('/v1/expenses').set('Authorization', owner.auth);
    const row = (list.body.data as Array<{ id: string; createdBy: string | null }>).find(
      (e) => e.id === expense.id,
    );
    expect(row).toBeDefined();
    expect(row?.createdBy).toBeNull();
  });
});
