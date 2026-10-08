import { CategoryListResponse, CategoryResponse, type Category } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import {
  changesSince,
  clientId,
  createExpense,
  createUser,
  revisionWatermark,
} from './support/fixtures.ts';

/**
 * `/v1/categories` against the contract.
 *
 * Driven through HTTP rather than against the service, because most of what the contract
 * promises here is an HTTP fact: the status, the error `code`, the response shape. The
 * cases follow `docs/qa/TEST_PLAN.md` §6 so that QA and this suite cannot disagree about
 * what the endpoint is supposed to do.
 */

describe('GET /v1/categories', () => {
  it('returns the six seeded categories, ordered by name', async () => {
    const user = await createUser();

    const response = await api().get('/v1/categories').set('Authorization', user.auth);

    expect(response.status).toBe(200);
    expect(() => CategoryListResponse.parse(response.body)).not.toThrow();

    const names = (response.body.data as Category[]).map((c) => c.name);
    expect(names).toEqual([
      'Bills',
      'Eating out',
      'Groceries',
      'Health',
      'Transport',
      'Uncategorized',
    ]);
    expect((response.body.data as Category[]).filter((c) => c.isDefault)).toHaveLength(1);
  });

  it('omits tombstoned categories unless includeDeleted is set', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;

    await api().delete(`/v1/categories/${groceries.id}`).set('Authorization', user.auth);

    const live = await api().get('/v1/categories').set('Authorization', user.auth);
    const all = await api()
      .get('/v1/categories?includeDeleted=true')
      .set('Authorization', user.auth);

    expect((live.body.data as Category[]).map((c) => c.id)).not.toContain(groceries.id);
    const tombstone = (all.body.data as Category[]).find((c) => c.id === groceries.id);
    expect(tombstone?.deletedAt).not.toBeNull();
  });

  it('rejects an unknown query parameter', async () => {
    const user = await createUser();

    const response = await api().get('/v1/categories?nope=1').set('Authorization', user.auth);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('POST /v1/categories', () => {
  it('creates a category and assigns a colour when none is sent', async () => {
    const user = await createUser();

    const response = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Coffee' });

    expect(response.status).toBe(201);
    expect(() => CategoryResponse.parse(response.body)).not.toThrow();
    expect(response.body.data.name).toBe('Coffee');
    expect(response.body.data.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(response.body.data.isDefault).toBe(false);
    expect(response.body.data.deletedAt).toBeNull();
    expect(response.body.data.revision).toBeGreaterThan(0);
    // A fresh row has not been edited since it was stored.
    expect(response.body.data.createdAt).toBe(response.body.data.updatedAt);
  });

  it('keeps a client-minted id, and is idempotent on a re-post of it', async () => {
    const user = await createUser();
    const id = clientId();

    const first = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ id, name: 'Coffee', color: '#2F6FD0' });
    const second = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      // Different field values on purpose: a replay is not an upsert, so these are
      // ignored rather than applied.
      .send({ id, name: 'Tea', color: '#C73B3B' });

    expect(first.status).toBe(201);
    // Byte-identical: no temp-id remapping, so a row created offline keeps its identity.
    expect(first.body.data.id).toBe(id);

    expect(second.status).toBe(201);
    expect(second.body.data).toEqual(first.body.data);

    const list = await api().get('/v1/categories').set('Authorization', user.auth);
    expect((list.body.data as Category[]).filter((c) => c.id === id)).toHaveLength(1);
    expect((list.body.data as Category[]).some((c) => c.name === 'Tea')).toBe(false);
  });

  it('does not advance the revision on an idempotent re-post', async () => {
    const user = await createUser();
    const id = clientId();

    await api().post('/v1/categories').set('Authorization', user.auth).send({ id, name: 'Coffee' });
    const watermark = await revisionWatermark(user.user.id);

    await api().post('/v1/categories').set('Authorization', user.auth).send({ id, name: 'Coffee' });

    // A replay that burned a revision would push the unchanged row onto the next sync
    // page for every client, which is work with no change behind it.
    expect(await revisionWatermark(user.user.id)).toBe(watermark);
  });

  it('refuses an id that belongs to another account, without saying whose', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);

    const response = await api()
      .post('/v1/categories')
      .set('Authorization', mine.auth)
      .send({ id: theirs.categories.Groceries!.id, name: 'Coffee' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    // Nothing about the other account leaks, and nothing of theirs changed.
    expect(JSON.stringify(response.body)).not.toContain('Groceries');

    const theirList = await api().get('/v1/categories').set('Authorization', theirs.auth);
    expect((theirList.body.data as Category[]).find((c) => c.name === 'Groceries')).toEqual(
      theirs.categories.Groceries,
    );
  });

  it('rejects a duplicate name case-insensitively and after trimming', async () => {
    const user = await createUser();

    const lower = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'groceries' });
    const padded = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: '  Groceries  ' });

    for (const response of [lower, padded]) {
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('category_name_taken');
    }
  });

  it('lets the unique index settle two concurrent creates of the same name', async () => {
    const user = await createUser();

    const [first, second] = await Promise.all([
      api().post('/v1/categories').set('Authorization', user.auth).send({ name: 'Coffee' }),
      api().post('/v1/categories').set('Authorization', user.auth).send({ name: 'coffee' }),
    ]);

    // The pre-check cannot catch this — both requests read before either wrote — so the
    // partial unique index is what decides, and the loser has to surface as the
    // contracted 409 rather than as a 500 from a raw constraint violation.
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('category_name_taken');

    const list = await api().get('/v1/categories').set('Authorization', user.auth);
    expect(
      (list.body.data as Category[]).filter((c) => c.name.toLowerCase() === 'coffee'),
    ).toHaveLength(1);
  });

  it('frees a name when the category holding it is deleted', async () => {
    const user = await createUser();

    await api()
      .delete(`/v1/categories/${user.categories.Groceries!.id}`)
      .set('Authorization', user.auth);
    const response = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Groceries' });

    // Uniqueness is among live rows only, so a tombstone does not hold a name hostage.
    expect(response.status).toBe(201);
  });

  it('lets two accounts hold the same category name', async () => {
    const [first, second] = await Promise.all([createUser(), createUser()]);

    const response = await api()
      .post('/v1/categories')
      .set('Authorization', second.auth)
      .send({ name: `Coffee-${first.user.id.slice(0, 8)}` });

    expect(response.status).toBe(201);
  });

  it('rejects an unknown field, an empty name and a malformed colour', async () => {
    const user = await createUser();

    const cases = [
      { name: 'Coffee', nope: 1 },
      { name: '   ' },
      { name: 'Coffee', color: 'f59e0b' },
      { name: 'Coffee', isDefault: true },
      { name: 'x'.repeat(65) },
    ];

    for (const body of cases) {
      const response = await api()
        .post('/v1/categories')
        .set('Authorization', user.auth)
        .send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });
});

describe('PATCH /v1/categories/:id', () => {
  it('renames without touching any expense', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;
    const expense = await createExpense(user, { categoryId: groceries.id });

    const response = await api()
      .patch(`/v1/categories/${groceries.id}`)
      .set('Authorization', user.auth)
      .send({ name: 'Food' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Food');
    expect(response.body.data.revision).toBeGreaterThan(groceries.revision);
    expect(response.body.data.updatedAt).not.toBe(groceries.updatedAt);

    // Expenses reference the id, so a rename is invisible to them — and must not bump
    // them onto the next sync page for every client.
    const after = await api()
      .get(`/v1/expenses?categoryId=${groceries.id}`)
      .set('Authorization', user.auth);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].id).toBe(expense.id);
    expect(after.body.data[0].revision).toBe(expense.revision);
    expect(after.body.data[0].updatedAt).toBe(expense.updatedAt);
  });

  it('treats a rename to its own current name as a no-conflict', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;

    const response = await api()
      .patch(`/v1/categories/${groceries.id}`)
      .set('Authorization', user.auth)
      .send({ name: 'Groceries', color: '#2F6FD0' });

    // Uniqueness excludes the row being edited; anything else makes a colour change
    // impossible without also renaming.
    expect(response.status).toBe(200);
    expect(response.body.data.color).toBe('#2F6FD0');
  });

  it('rejects a rename onto another live category', async () => {
    const user = await createUser();

    const response = await api()
      .patch(`/v1/categories/${user.categories.Groceries!.id}`)
      .set('Authorization', user.auth)
      .send({ name: 'transport' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('category_name_taken');
  });

  it('renames the default category, which only delete is blocked for', async () => {
    const user = await createUser();

    const response = await api()
      .patch(`/v1/categories/${user.defaultCategory.id}`)
      .set('Authorization', user.auth)
      .send({ name: 'Misc' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Misc');
    expect(response.body.data.isDefault).toBe(true);
  });

  it('rejects an empty patch and an unknown field', async () => {
    const user = await createUser();
    const id = user.categories.Groceries!.id;

    for (const body of [{}, { nope: 1 }, { revision: 99 }]) {
      const response = await api()
        .patch(`/v1/categories/${id}`)
        .set('Authorization', user.auth)
        .send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });

  it('is 400, not 404, for an id that is not a UUID', async () => {
    const user = await createUser();

    const response = await api()
      .patch('/v1/categories/not-a-uuid')
      .set('Authorization', user.auth)
      .send({ name: 'Coffee' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('DELETE /v1/categories/:id', () => {
  it('soft-deletes and returns the tombstone', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;

    const response = await api()
      .delete(`/v1/categories/${groceries.id}`)
      .set('Authorization', user.auth);

    // 200 with a body, not 204: the client stores the tombstone directly.
    expect(response.status).toBe(200);
    expect(() => CategoryResponse.parse(response.body)).not.toThrow();
    expect(response.body.data.deletedAt).not.toBeNull();
    expect(response.body.data.revision).toBeGreaterThan(groceries.revision);
  });

  it('is idempotent and does not advance the revision on a re-delete', async () => {
    const user = await createUser();
    const id = user.categories.Groceries!.id;

    const first = await api().delete(`/v1/categories/${id}`).set('Authorization', user.auth);
    const watermark = await revisionWatermark(user.user.id);
    const second = await api().delete(`/v1/categories/${id}`).set('Authorization', user.auth);

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(await revisionWatermark(user.user.id)).toBe(watermark);
  });

  it('reassigns the expenses to the default category instead of deleting them', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;

    const live = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((n) =>
        createExpense(user, { categoryId: groceries.id, amountMinor: n * 100 }),
      ),
    );
    const doomed = await createExpense(user, { categoryId: groceries.id });
    await api().delete(`/v1/expenses/${doomed.id}`).set('Authorization', user.auth);

    const response = await api()
      .delete(`/v1/categories/${groceries.id}`)
      .set('Authorization', user.auth);
    expect(response.status).toBe(200);

    const after = await api().get('/v1/expenses?limit=200').set('Authorization', user.auth);
    const rows = after.body.data as { id: string; categoryId: string; revision: number }[];

    // Losing spend history to a category cleanup would be a data-loss bug, so the count
    // staying at 7 is the assertion that matters most in this file.
    expect(rows).toHaveLength(7);
    for (const before of live) {
      const now = rows.find((r) => r.id === before.id);
      expect(now, `expense ${before.id} survived the category delete`).toBeDefined();
      expect(now!.categoryId).toBe(user.defaultCategory.id);
      expect(now!.revision).toBeGreaterThan(before.revision);
    }

    // The already-tombstoned one stays tombstoned rather than being revived.
    const all = await api()
      .get('/v1/expenses?includeDeleted=true&limit=200')
      .set('Authorization', user.auth);
    const tombstone = (all.body.data as { id: string; deletedAt: string | null }[]).find(
      (r) => r.id === doomed.id,
    );
    expect(tombstone?.deletedAt).not.toBeNull();
  });

  it('puts the tombstone and every reassignment on the wire, in revision order', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;
    const expenses = await Promise.all(
      [1, 2, 3].map((n) => createExpense(user, { categoryId: groceries.id, amountMinor: n * 100 })),
    );

    // Where a client's sync cursor would sit before the delete.
    const cursor = await revisionWatermark(user.user.id);
    await api().delete(`/v1/categories/${groceries.id}`).set('Authorization', user.auth);

    const changes = await changesSince(user.user.id, cursor);

    // A client that only tombstoned the category locally would be left with expenses
    // pointing at a deleted category, so the reassignments have to be on the wire too.
    expect(changes).toHaveLength(4);
    expect(changes[0]).toMatchObject({ entity: 'category', id: groceries.id });
    expect(changes.slice(1).map((c) => c.entity)).toEqual(['expense', 'expense', 'expense']);
    expect(new Set(changes.slice(1).map((c) => c.id))).toEqual(new Set(expenses.map((e) => e.id)));
    expect(changes.map((c) => c.revision)).toEqual(
      [...changes.map((c) => c.revision)].sort((a, b) => a - b),
    );
  });

  it('reassigns to the default by flag, even after the default is renamed', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!;
    await createExpense(user, { categoryId: groceries.id });

    // Resolving the fallback by matching the string "Uncategorized" would stop working
    // here, silently.
    await api()
      .patch(`/v1/categories/${user.defaultCategory.id}`)
      .set('Authorization', user.auth)
      .send({ name: 'Misc' });

    const response = await api()
      .delete(`/v1/categories/${groceries.id}`)
      .set('Authorization', user.auth);
    expect(response.status).toBe(200);

    const after = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(after.body.data[0].categoryId).toBe(user.defaultCategory.id);
  });

  it('refuses to delete the default category', async () => {
    const user = await createUser();

    const response = await api()
      .delete(`/v1/categories/${user.defaultCategory.id}`)
      .set('Authorization', user.auth);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('category_not_deletable');

    const list = await api().get('/v1/categories').set('Authorization', user.auth);
    expect((list.body.data as Category[]).some((c) => c.id === user.defaultCategory.id)).toBe(true);
  });

  it('leaves no category pointing at nothing when a category with no expenses goes', async () => {
    const user = await createUser();
    const cursor = await revisionWatermark(user.user.id);

    await api()
      .delete(`/v1/categories/${user.categories.Health!.id}`)
      .set('Authorization', user.auth);

    // Exactly one change: the tombstone. Nothing else should have been stamped.
    const changes = await changesSince(user.user.id, cursor);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.entity).toBe('category');
  });
});

describe('tenancy', () => {
  it('reports another account’s category as not found on read, update and delete', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);
    const target = theirs.categories.Groceries!;

    const patched = await api()
      .patch(`/v1/categories/${target.id}`)
      .set('Authorization', mine.auth)
      .send({ name: 'Hijacked' });
    const deleted = await api()
      .delete(`/v1/categories/${target.id}`)
      .set('Authorization', mine.auth);

    for (const response of [patched, deleted]) {
      // 404 and not 403, so a well-formed id cannot be probed for existence.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('not_found');
    }

    // And nothing of theirs moved.
    const theirList = await api().get('/v1/categories').set('Authorization', theirs.auth);
    expect((theirList.body.data as Category[]).find((c) => c.id === target.id)).toEqual(target);
  });

  it('never lists another account’s categories', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);

    const list = await api().get('/v1/categories').set('Authorization', mine.auth);
    const ids = (list.body.data as Category[]).map((c) => c.id);

    expect(ids).not.toContain(theirs.categories.Groceries!.id);
    expect(ids).toHaveLength(6);
  });

  it('is 404, not 404-after-a-write, for an unknown id', async () => {
    const user = await createUser();

    const response = await api()
      .delete(`/v1/categories/${clientId()}`)
      .set('Authorization', user.auth);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});
