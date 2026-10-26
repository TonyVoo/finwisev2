import { DEFAULT_CATEGORIES, LIMITS, type Category } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';
import { pull, pushItem, pushOk, resultFor } from './support/sync.ts';

/**
 * A category's monthly budget: `monthlyBudgetMinor`, an attribute of the category that
 * rides the category's own sync rather than being an entity of its own.
 */

function createCategory(auth: string, body: object) {
  return api().post('/v1/categories').set('Authorization', auth).send(body);
}

function patchCategory(auth: string, id: string, body: object) {
  return api().patch(`/v1/categories/${id}`).set('Authorization', auth).send(body);
}

describe('monthlyBudgetMinor over REST', () => {
  it('is null on every seeded category and on a category created without one', async () => {
    const user = await createUser();

    for (const seeded of Object.values(user.categories)) {
      expect(seeded.monthlyBudgetMinor).toBeNull();
    }
    expect(Object.keys(user.categories)).toHaveLength(DEFAULT_CATEGORIES.length);

    const created = await createCategory(user.auth, { name: 'Pets' });
    expect(created.status).toBe(201);
    expect((created.body.data as Category).monthlyBudgetMinor).toBeNull();
  });

  it('can be set at creation, then changed, then cleared with null', async () => {
    const user = await createUser();

    const created = await createCategory(user.auth, { name: 'Pets', monthlyBudgetMinor: 25000 });
    expect(created.status).toBe(201);
    const id = (created.body.data as Category).id;
    expect((created.body.data as Category).monthlyBudgetMinor).toBe(25000);

    const changed = await patchCategory(user.auth, id, { monthlyBudgetMinor: 30000 });
    expect((changed.body.data as Category).monthlyBudgetMinor).toBe(30000);

    // Absent leaves it alone: renaming must not wipe the budget.
    const renamed = await patchCategory(user.auth, id, { name: 'Pet care' });
    expect((renamed.body.data as Category).monthlyBudgetMinor).toBe(30000);

    const cleared = await patchCategory(user.auth, id, { monthlyBudgetMinor: null });
    expect(cleared.status).toBe(200);
    expect((cleared.body.data as Category).monthlyBudgetMinor).toBeNull();
  });

  it('rejects zero, negatives, fractions, strings and over-limit values', async () => {
    const user = await createUser();
    const id = user.categories['Groceries']!.id;

    for (const bad of [0, -1, 12.5, '100', LIMITS.AMOUNT_MINOR_MAX + 1]) {
      const response = await patchCategory(user.auth, id, { monthlyBudgetMinor: bad });
      expect(response.status, `${String(bad)}`).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
    // And nothing was written.
    const row = await getPrisma().category.findUniqueOrThrow({ where: { id } });
    expect(row.monthlyBudgetMinor).toBeNull();
  });

  it('accepts the maximum exactly', async () => {
    const user = await createUser();
    const response = await patchCategory(user.auth, user.categories['Bills']!.id, {
      monthlyBudgetMinor: LIMITS.AMOUNT_MINOR_MAX,
    });
    expect(response.status).toBe(200);
    expect((response.body.data as Category).monthlyBudgetMinor).toBe(LIMITS.AMOUNT_MINOR_MAX);
  });

  it('is returned by the list, and survives a delete-reassign of a different category', async () => {
    const user = await createUser();
    await patchCategory(user.auth, user.categories['Groceries']!.id, { monthlyBudgetMinor: 40000 });
    await api()
      .delete(`/v1/categories/${user.categories['Transport']!.id}`)
      .set('Authorization', user.auth);

    const list = await api().get('/v1/categories').set('Authorization', user.auth);
    const groceries = (list.body.data as Category[]).find((c) => c.name === 'Groceries');
    expect(groceries?.monthlyBudgetMinor).toBe(40000);
  });

  it("does not let one user's budget reach another's category", async () => {
    const owner = await createUser();
    const other = await createUser();
    const response = await patchCategory(other.auth, owner.categories['Groceries']!.id, {
      monthlyBudgetMinor: 1,
    });
    expect(response.status).toBe(404);
    const row = await getPrisma().category.findUniqueOrThrow({
      where: { id: owner.categories['Groceries']!.id },
    });
    expect(row.monthlyBudgetMinor).toBeNull();
  });
});

describe('monthlyBudgetMinor over sync', () => {
  it('creates a category with a budget, and the pull delivers it', async () => {
    const user = await createUser();
    const id = uuidv7();
    const results = await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        fields: { name: 'Pets', color: '#2F8044', monthlyBudgetMinor: 25000 },
      }),
    ]);
    const result = resultFor(results, id);
    expect(result.status).toBe('applied');
    expect((result.record as Category).monthlyBudgetMinor).toBe(25000);

    const page = await pull(user, { since: 0 });
    const delivered = page.changes.find((c) => c.entity === 'category' && c.record.id === id);
    expect((delivered?.record as Category).monthlyBudgetMinor).toBe(25000);
  });

  it('sets, leaves alone when absent, and clears with null', async () => {
    const user = await createUser();
    const id = user.categories['Health']!.id;
    const at = (offset: number) => new Date(Date.now() + offset).toISOString();

    await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: at(1_000),
        fields: { monthlyBudgetMinor: 5000 },
      }),
    ]);
    const renamed = await pushOk(user, [
      pushItem({ entity: 'category', id, updatedAt: at(2_000), fields: { name: 'Wellness' } }),
    ]);
    expect((resultFor(renamed, id).record as Category).monthlyBudgetMinor).toBe(5000);

    const cleared = await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: at(3_000),
        fields: { monthlyBudgetMinor: null },
      }),
    ]);
    expect((resultFor(cleared, id).record as Category).monthlyBudgetMinor).toBeNull();
  });

  it('is last-write-wins like every other field: a stale budget edit loses and reports the winner', async () => {
    const user = await createUser();
    const id = user.categories['Bills']!.id;
    const now = Date.now();

    await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: new Date(now + 2_000).toISOString(),
        fields: { monthlyBudgetMinor: 9000 },
      }),
    ]);
    const stale = await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: new Date(now + 1_000).toISOString(),
        fields: { monthlyBudgetMinor: 1000 },
      }),
    ]);

    const result = resultFor(stale, id);
    expect(result.status).toBe('conflict_server_wins');
    expect((result.record as Category).monthlyBudgetMinor).toBe(9000);
  });

  it('marks an out-of-range budget invalid for that record only, and writes nothing', async () => {
    const user = await createUser();
    const bad = user.categories['Health']!.id;
    const good = user.categories['Bills']!.id;

    const results = await pushOk(user, [
      pushItem({ entity: 'category', id: bad, fields: { monthlyBudgetMinor: 0 } }),
      pushItem({ entity: 'category', id: good, fields: { monthlyBudgetMinor: 1200 } }),
    ]);

    // One bad row cannot fail the batch (docs/PLAN.md §4).
    expect(resultFor(results, bad).status).toBe('invalid');
    expect(resultFor(results, good).status).toBe('applied');
    const row = await getPrisma().category.findUniqueOrThrow({ where: { id: bad } });
    expect(row.monthlyBudgetMinor).toBeNull();
  });

  it('keeps the budget through a delete and an undelete', async () => {
    const user = await createUser();
    const id = uuidv7();
    const t = Date.now();
    await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: new Date(t + 1_000).toISOString(),
        fields: { name: 'Gifts', color: '#2F8044', monthlyBudgetMinor: 7000 },
      }),
    ]);
    await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: new Date(t + 2_000).toISOString(),
        fields: { deletedAt: new Date(t + 2_000).toISOString() },
      }),
    ]);
    const undeleted = await pushOk(user, [
      pushItem({
        entity: 'category',
        id,
        updatedAt: new Date(t + 3_000).toISOString(),
        fields: { deletedAt: null },
      }),
    ]);
    expect((resultFor(undeleted, id).record as Category).monthlyBudgetMinor).toBe(7000);
  });
});

describe('the database constraint behind it', () => {
  it('refuses a zero or negative budget even if the application layer were bypassed', async () => {
    const user = await createUser();
    const id = user.categories['Groceries']!.id;
    const prisma = getPrisma();

    await expect(
      prisma.$executeRaw`UPDATE categories SET monthly_budget_minor = 0 WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE categories SET monthly_budget_minor = -5 WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE categories SET monthly_budget_minor = 1000 WHERE id = ${id}::uuid`,
    ).resolves.toBe(1);
  });
});
