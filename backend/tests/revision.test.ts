import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { changesSince, createExpense, createUser, revisionWatermark } from './support/fixtures.ts';

/**
 * `revision` is what makes a write reachable.
 *
 * `GET /v1/sync?since=<cursor>` serves rows with `revision > cursor`. A write that
 * advances `updatedAt` but not `revision` is therefore invisible to every client whose
 * cursor is already past it — the row is correct on the server and permanently stale
 * everywhere else, with nothing in any response to indicate it. That is the single
 * easiest way for this API to lose a user's edit, so it gets its own file.
 *
 * `GET /v1/sync` itself lands in the next task. Until then `changesSince` applies the
 * pull's selection predicate — `revision > cursor`, ordered by `revision` — straight to
 * the tables, which is the same question the endpoint will ask.
 */

describe('every write advances the revision and so reaches a syncing client', () => {
  it('covers all six write paths', async () => {
    const user = await createUser();
    const auth = { Authorization: user.auth };

    // Each step records where a client's cursor would be, performs one write, and
    // asserts the write is on the far side of that cursor.
    const steps: { label: string; act: () => Promise<{ id: string; revision: number }> }[] = [
      {
        label: 'create a category',
        act: async () => {
          const response = await api().post('/v1/categories').set(auth).send({ name: 'Coffee' });
          expect(response.status).toBe(201);
          return response.body.data;
        },
      },
      {
        label: 'rename a category',
        act: async () => {
          const response = await api()
            .patch(`/v1/categories/${user.categories.Groceries!.id}`)
            .set(auth)
            .send({ name: 'Food' });
          expect(response.status).toBe(200);
          return response.body.data;
        },
      },
      {
        label: 'create an expense',
        act: async () => {
          const response = await api().post('/v1/expenses').set(auth).send({
            categoryId: user.categories.Transport!.id,
            amountMinor: 300,
            date: '2026-10-06',
          });
          expect(response.status).toBe(201);
          return response.body.data;
        },
      },
    ];

    for (const step of steps) {
      const cursor = await revisionWatermark(user.user.id);
      const written = await step.act();

      expect(written.revision, step.label).toBeGreaterThan(cursor);
      const delivered = await changesSince(user.user.id, cursor);
      expect(
        delivered.map((c) => c.id),
        `${step.label} must appear to a client sitting at revision ${cursor}`,
      ).toContain(written.id);
    }

    // The three paths that need a row to already exist.
    const expense = await createExpense(user, { categoryId: user.categories.Transport!.id });

    const beforePatch = await revisionWatermark(user.user.id);
    const patched = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set(auth)
      .send({ amountMinor: 999 });
    expect(patched.body.data.revision).toBeGreaterThan(beforePatch);
    expect((await changesSince(user.user.id, beforePatch)).map((c) => c.id)).toContain(expense.id);

    const beforeExpenseDelete = await revisionWatermark(user.user.id);
    const deletedExpense = await api().delete(`/v1/expenses/${expense.id}`).set(auth);
    expect(deletedExpense.body.data.revision).toBeGreaterThan(beforeExpenseDelete);
    // A tombstone is a change like any other: it is the only way a delete crosses the
    // wire, so it has to be stamped like one.
    expect((await changesSince(user.user.id, beforeExpenseDelete)).map((c) => c.id)).toContain(
      expense.id,
    );

    const beforeCategoryDelete = await revisionWatermark(user.user.id);
    const deletedCategory = await api()
      .delete(`/v1/categories/${user.categories.Health!.id}`)
      .set(auth);
    expect(deletedCategory.body.data.revision).toBeGreaterThan(beforeCategoryDelete);
    expect((await changesSince(user.user.id, beforeCategoryDelete)).map((c) => c.id)).toContain(
      user.categories.Health!.id,
    );
  });

  it('hands out strictly increasing, never-repeated revisions', async () => {
    const user = await createUser();

    for (let i = 0; i < 5; i += 1) {
      await api()
        .post('/v1/categories')
        .set('Authorization', user.auth)
        .send({ name: `Cat ${i}` });
      await createExpense(user, {
        categoryId: user.categories.Groceries!.id,
        amountMinor: (i + 1) * 10,
      });
    }

    const changes = await changesSince(user.user.id, 0);
    const revisions = changes.map((c) => c.revision);

    // Unique across *both* tables, not just within one: the cursor is a single watermark
    // over the user's whole change stream, so two rows sharing a revision means one of
    // them can be stepped over.
    expect(new Set(revisions).size).toBe(revisions.length);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(Math.min(...revisions)).toBeGreaterThan(0);
  });

  it('keeps each account on its own sequence', async () => {
    const [first, second] = await Promise.all([createUser(), createUser()]);

    await api().post('/v1/categories').set('Authorization', first.auth).send({ name: 'Coffee' });

    // A global sequence would make the second account's cursor skip past rows it has
    // never seen, because another account's writes advanced it.
    const secondChanges = await changesSince(second.user.id, 0);
    expect(secondChanges).toHaveLength(6);
    expect(secondChanges.map((c) => c.revision)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('a write that does not advance the revision is invisible', () => {
  it('is skipped by the pull predicate, which is why every handler must stamp', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    // Where a client's cursor sits after it has pulled everything.
    const cursor = await revisionWatermark(user.user.id);
    expect(await changesSince(user.user.id, cursor)).toEqual([]);

    // Simulate the bug this invariant exists to prevent: a handler that updates the row
    // and its `updatedAt` but leaves `revision` alone. Written directly, because no
    // endpoint can produce it — which is the point of asserting it here.
    await getPrisma().expense.update({
      where: { id: expense.id },
      data: { amountMinor: 99_999n, updatedAt: new Date() },
    });

    const stored = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(Number(stored.amountMinor)).toBe(99_999);

    // The edit is correct on the server and unreachable from the client: no error, no
    // retry, no indication anywhere that it exists. Hence the rule.
    expect(await changesSince(user.user.id, cursor)).toEqual([]);
  });

  it('does not re-deliver a row on an idempotent no-op write', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    const cursor = await revisionWatermark(user.user.id);

    // Both of these are deliberate no-ops: a replayed create and a replayed delete.
    await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({ id: expense.id, categoryId: expense.categoryId, amountMinor: 1, date: '2026-10-06' });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    // Nothing changed, so nothing is re-delivered. The other direction of the same rule:
    // burning a revision on a no-op is pointless work for every client on the account.
    expect(await revisionWatermark(user.user.id)).toBe(cursor);
    expect(await changesSince(user.user.id, cursor)).toEqual([]);
  });

  it('rolls the revision back with a failed write, leaving no gap', async () => {
    const user = await createUser();
    const before = await revisionWatermark(user.user.id);

    // Fails inside the transaction, after the name check and before the insert commits.
    const rejected = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Groceries' });
    expect(rejected.status).toBe(409);

    // The counter is bumped inside the writing transaction, so a rollback takes the
    // increment with it. A gap would be harmless to the cursor, but a counter that
    // advanced without a row is a sign the increment escaped its transaction — and an
    // increment that can escape can also be handed out twice.
    expect(await revisionWatermark(user.user.id)).toBe(before);

    const accepted = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Coffee' });
    expect(accepted.body.data.revision).toBe(before + 1);
  });
});
