import { HouseholdResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';
import { pullAll } from './support/sync.ts';

/**
 * The household's book, and handing the household to someone else
 * (`docs/design/10-households.md`).
 *
 * The household owns a book of its own - a hidden account-like record - rather than living
 * under its owner's account. That is what makes ownership transferable: the rows were never
 * the owner's, so handing over changes a role and moves nothing.
 */

async function createHousehold(owner: TestUser) {
  return await api().post('/v1/household').set('Authorization', owner.auth).send({});
}

async function join(member: TestUser, owner: TestUser) {
  const invite = await api().post('/v1/household/invite').set('Authorization', owner.auth).send({});
  return await api()
    .post('/v1/household/join')
    .set('Authorization', member.auth)
    .send({ code: invite.body.data.code });
}

async function householdOfTwo(): Promise<{ owner: TestUser; member: TestUser }> {
  const owner = await createUser();
  const member = await createUser();
  expect((await createHousehold(owner)).status).toBe(201);
  expect((await join(member, owner)).status).toBe(200);
  return { owner, member };
}

async function transfer(from: TestUser, to: TestUser) {
  return await api()
    .post('/v1/household/transfer')
    .set('Authorization', from.auth)
    .send({ memberId: to.user.id });
}

async function me(user: TestUser) {
  return (await api().get('/v1/me').set('Authorization', user.auth)).body;
}

async function expensesOf(user: TestUser) {
  const response = await api().get('/v1/expenses').set('Authorization', user.auth);
  expect(response.status).toBe(200);
  return response.body.data as Array<{ id: string; categoryId: string; revision: number }>;
}

async function categoriesOf(user: TestUser) {
  const response = await api().get('/v1/categories').set('Authorization', user.auth);
  expect(response.status).toBe(200);
  return response.body.data as Array<{ id: string; name: string; isDefault: boolean }>;
}

describe('the household book', () => {
  it('is its own scope: neither the owner nor a member works in their own account id', async () => {
    const { owner, member } = await householdOfTwo();

    const asOwner = await me(owner);
    const asMember = await me(member);

    expect(asOwner.dataOwnerId).not.toBe(owner.user.id);
    expect(asOwner.dataOwnerId).not.toBe(member.user.id);
    expect(asMember.dataOwnerId).toBe(asOwner.dataOwnerId);
    // Identity is untouched.
    expect(asOwner.user.id).toBe(owner.user.id);
  });

  it("moves the creator's existing books into it, and leaves their own account empty", async () => {
    const owner = await createUser();
    const before = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    await createHousehold(owner);

    expect((await expensesOf(owner)).map((e) => e.id)).toEqual([before.id]);
    expect(await getPrisma().expense.count({ where: { userId: owner.user.id } })).toBe(0);
    expect(await getPrisma().category.count({ where: { userId: owner.user.id } })).toBe(0);
  });

  it('keeps revisions climbing across the move, so a device never skips or repeats a row', async () => {
    const owner = await createUser();
    const before = await createExpense(owner, { categoryId: owner.defaultCategory.id });
    await createHousehold(owner);

    const after = await createExpense(owner, { categoryId: owner.defaultCategory.id });

    expect(after.revision).toBeGreaterThan(before.revision);
    const { changes } = await pullAll(owner);
    const revisions = changes.map((change) => change.record.revision);
    expect(new Set(revisions).size).toBe(revisions.length);
  });

  it('reports the owner as the owner, not the book', async () => {
    const { owner, member } = await householdOfTwo();

    const household = HouseholdResponse.parse(
      (await api().get('/v1/household').set('Authorization', member.auth)).body,
    ).household;

    expect(household?.ownerId).toBe(owner.user.id);
    expect(household?.members.find((m) => m.role === 'owner')?.userId).toBe(owner.user.id);
  });

  it('cannot be signed in to', async () => {
    await householdOfTwo();
    const book = await getPrisma().household.findFirstOrThrow({ include: { book: true } });

    const response = await api()
      .post('/v1/auth/login')
      .send({ email: book.book.email, password: 'correct-horse-battery' });

    expect(response.status).toBe(401);
  });
});

describe('POST /v1/household/transfer', () => {
  it('makes a member the owner and the caller a member, moving no data', async () => {
    const { owner, member } = await householdOfTwo();
    const expense = await createExpense(owner, { categoryId: owner.defaultCategory.id });
    const scopeBefore = (await me(owner)).dataOwnerId;

    const response = await transfer(owner, member);

    expect(response.status).toBe(200);
    const { household } = HouseholdResponse.parse(response.body);
    expect(household).toMatchObject({ role: 'member', ownerId: member.user.id });
    const asNewOwner = await api().get('/v1/household').set('Authorization', member.auth);
    expect(asNewOwner.body.household.role).toBe('owner');
    // Nothing moved: same books for both, and the rows still say who added them.
    expect((await me(owner)).dataOwnerId).toBe(scopeBefore);
    expect((await me(member)).dataOwnerId).toBe(scopeBefore);
    expect((await expensesOf(member)).map((e) => e.id)).toContain(expense.id);
    const row = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(row.createdBy).toBe(owner.user.id);
  });

  it('gives the new owner the owner powers, and takes them from the old one', async () => {
    const { owner, member } = await householdOfTwo();
    await transfer(owner, member);

    const newInvite = await api()
      .post('/v1/household/invite')
      .set('Authorization', member.auth)
      .send({});
    const oldInvite = await api()
      .post('/v1/household/invite')
      .set('Authorization', owner.auth)
      .send({});

    expect(newInvite.status).toBe(201);
    expect(oldInvite.status).toBe(403);
    expect(oldInvite.body.error.code).toBe('household_owner_only');
  });

  it('lets the former owner leave afterwards, and fresh default categories await them', async () => {
    const { owner, member } = await householdOfTwo();
    await transfer(owner, member);

    const left = await api().post('/v1/household/leave').set('Authorization', owner.auth).send({});

    expect(left.status).toBe(204);
    expect((await me(owner)).dataOwnerId).toBe(owner.user.id);
    const categories = await categoriesOf(owner);
    expect(categories.length).toBeGreaterThanOrEqual(6);
    expect(categories.filter((c) => c.isDefault)).toHaveLength(1);
    // ...and they can add an expense to their own books straight away.
    const created = await createExpense(owner, {
      categoryId: categories.find((c) => c.isDefault)!.id,
    });
    expect(created.createdBy).toBe(owner.user.id);
  });

  it('is 403 for a member, 404 for a person in no household', async () => {
    const { owner, member } = await householdOfTwo();
    const stranger = await createUser();

    const asMember = await transfer(member, owner);
    const asStranger = await transfer(stranger, owner);

    expect(asMember.status).toBe(403);
    expect(asMember.body.error.code).toBe('household_owner_only');
    expect(asStranger.status).toBe(404);
    expect(asStranger.body.error.code).toBe('not_in_household');
  });

  it('is 404 for someone who is not in the household, and changes nothing', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();

    const response = await transfer(owner, stranger);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
    const household = await api().get('/v1/household').set('Authorization', owner.auth);
    expect(household.body.household.role).toBe('owner');
  });

  it('is 400 when the owner names themselves', async () => {
    const { owner } = await householdOfTwo();

    const response = await transfer(owner, owner);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('lets a sole owner delete their account once nobody else is in', async () => {
    const owner = await createUser();
    await createExpense(owner, { categoryId: owner.defaultCategory.id });
    await createHousehold(owner);

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', owner.auth)
      .send({ password: owner.password });

    expect(response.status).toBe(204);
    expect(await getPrisma().household.count()).toBe(0);
    // The household's books went with it: nothing orphaned.
    expect(await getPrisma().expense.count()).toBe(0);
    expect(await getPrisma().category.count()).toBe(0);
  });

  it('lets the former owner delete their account once ownership has moved', async () => {
    const { owner, member } = await householdOfTwo();
    await transfer(owner, member);

    const response = await api()
      .delete('/v1/me')
      .set('Authorization', owner.auth)
      .send({ password: owner.password });

    expect(response.status).toBe(204);
    // The household and its books are untouched.
    const household = await api().get('/v1/household').set('Authorization', member.auth);
    expect(household.body.household.members).toHaveLength(1);
    expect((await expensesOf(member)).length).toBe(0);
    expect((await categoriesOf(member)).length).toBeGreaterThan(0);
  });
});

describe('DELETE /v1/household gives the books to the owner', () => {
  it('returns the creator their own books, as they were', async () => {
    const { owner, member } = await householdOfTwo();
    const mine = await createExpense(owner, { categoryId: owner.defaultCategory.id });
    const theirs = await createExpense(member, { categoryId: owner.defaultCategory.id });

    const response = await api().delete('/v1/household').set('Authorization', owner.auth);

    expect(response.status).toBe(204);
    expect((await me(owner)).dataOwnerId).toBe(owner.user.id);
    expect((await expensesOf(owner)).map((e) => e.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect((await categoriesOf(owner)).filter((c) => c.isDefault)).toHaveLength(1);
    // The member is back on their own, separate books.
    expect((await me(member)).dataOwnerId).toBe(member.user.id);
    expect((await expensesOf(member)).map((e) => e.id)).not.toContain(theirs.id);
    expect(await getPrisma().household.count()).toBe(0);
  });

  it('merges into the books a transferred owner already has, without duplicating categories', async () => {
    const { owner, member } = await householdOfTwo();
    // The member's own private books, hidden while they are in the household.
    const privateCategories = await getPrisma().category.findMany({
      where: { userId: member.user.id },
    });
    const privateGroceries = privateCategories.find((c) => c.name === 'Groceries')!;
    const privateExpense = await getPrisma().expense.create({
      data: {
        id: '0192f5a0-0000-7000-8000-0000000000f1',
        userId: member.user.id,
        categoryId: privateGroceries.id,
        amountMinor: 111n,
        currency: 'USD',
        date: new Date('2026-10-01'),
        updatedAt: new Date(),
        revision: 99,
      },
    });
    await getPrisma().revisionCounter.update({
      where: { userId: member.user.id },
      data: { lastRevision: 99 },
    });
    // The household's books: a shared expense in Groceries and one in a category only it has.
    const shared = await categoriesOf(owner);
    const sharedGroceries = shared.find((c) => c.name === 'Groceries')!;
    const pets = await api()
      .post('/v1/categories')
      .set('Authorization', owner.auth)
      .send({ name: 'Pets' });
    const inGroceries = await createExpense(owner, { categoryId: sharedGroceries.id });
    const inPets = await createExpense(owner, { categoryId: pets.body.data.id });
    await transfer(owner, member);

    const response = await api().delete('/v1/household').set('Authorization', member.auth);

    expect(response.status).toBe(204);
    const expenses = await expensesOf(member);
    expect(expenses.map((e) => e.id).sort()).toEqual(
      [privateExpense.id, inGroceries.id, inPets.id].sort(),
    );
    const categories = await categoriesOf(member);
    const names = categories.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('pets');
    expect(categories.filter((c) => c.isDefault)).toHaveLength(1);
    // The shared Groceries expense now sits in the member's own Groceries.
    const ownGroceries = categories.find((c) => c.name === 'Groceries')!;
    expect(expenses.find((e) => e.id === inGroceries.id)?.categoryId).toBe(ownGroceries.id);
    // Revisions are unique and the counter is ahead of every one of them.
    const revisions = expenses.map((e) => e.revision);
    expect(new Set(revisions).size).toBe(revisions.length);
    const counter = await getPrisma().revisionCounter.findUniqueOrThrow({
      where: { userId: member.user.id },
    });
    expect(counter.lastRevision).toBeGreaterThanOrEqual(Math.max(...revisions));
    // And the device can keep syncing: a pull returns every row exactly once.
    const { changes } = await pullAll(member);
    const ids = changes.map((c) => c.record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
