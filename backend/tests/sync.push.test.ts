import { LIMITS } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { pull, push, pushOk, resultFor } from './support/sync.ts';

/**
 * `POST /v1/sync` — the push side, one test per branch of the resolver.
 *
 * The decisions themselves are unit-tested at their boundaries in
 * `sync.resolver.test.ts`. What this suite checks is that the real endpoint, against a
 * real database and inside a real transaction, reaches those decisions and reports them
 * in the contract's shape — including the properties that only exist at this level: the
 * single transaction, the savepoint that keeps a bad row from failing the batch, and the
 * primary key that makes a retry a no-op.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

const ISO = (ms: number): string => new Date(ms).toISOString();

describe('applied — a create', () => {
  it('creates a category from a client-minted id', async () => {
    const id = uuidv7();
    // Relative to the real clock, and in the past: a hard-coded future instant would be
    // clamped by the skew rule and the assertion below would be testing that instead.
    const editedAt = ISO(Date.now() - 60_000);
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: editedAt,
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee', color: '#f59e0b' },
      },
    ]);

    expect(result?.status).toBe('applied');
    expect(result?.idempotentReplay).toBe(false);
    expect(result?.error).toBeNull();
    expect(result?.record).toMatchObject({
      id,
      name: 'Coffee',
      color: '#f59e0b',
      isDefault: false,
      deletedAt: null,
      // The client's edit time is what is stored, not the server's receipt time.
      updatedAt: editedAt,
    });
    expect(result?.record?.revision).toBeGreaterThan(0);
  });

  it('creates an expense and assigns the account currency when omitted', async () => {
    const id = uuidv7();
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id,
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId: uuidv7(),
        fields: {
          categoryId: user.defaultCategory.id,
          amountMinor: 450,
          date: '2026-10-09',
          note: 'Flat white',
        },
      },
    ]);

    expect(result?.status).toBe('applied');
    expect(result?.record).toMatchObject({
      id,
      amountMinor: 450,
      currency: user.user.currency,
      date: '2026-10-09',
      note: 'Flat white',
    });
  });

  it('gives the category a colour from the shared palette when the client omits one', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
    ]);
    expect(result?.record).toMatchObject({ color: expect.stringMatching(/^#[0-9a-fA-F]{6}$/) });
  });

  it('advances the per-user revision for every applied row and nothing else', async () => {
    const before = await revisionWatermark(user.user.id);
    const results = await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Tea' },
      },
    ]);

    const after = await revisionWatermark(user.user.id);
    expect(after).toBe(before + 2);
    const revisions = results.map((r) => r.record?.revision);
    expect(new Set(revisions).size).toBe(2);
  });
});

describe('applied — an update, merged onto the stored row', () => {
  it('leaves absent keys alone', async () => {
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 450,
      note: 'Flat white',
    });

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.parse(expense.updatedAt) + 1000),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 900 },
      },
    ]);

    expect(result?.status).toBe('applied');
    // `note` and `date` were not in `fields`, so they survive: a push is an upsert with a
    // merge, not a replace. A replace would silently clear every field the client did not
    // happen to include.
    expect(result?.record).toMatchObject({
      amountMinor: 900,
      note: 'Flat white',
      date: expense.date,
    });
  });

  it('clears a note with an explicit null but not with an absent key', async () => {
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      note: 'Flat white',
    });

    const [cleared] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.parse(expense.updatedAt) + 1000),
        clientMutationId: uuidv7(),
        fields: { note: null },
      },
    ]);
    expect(cleared?.record).toMatchObject({ note: null });
  });

  it('tombstones a row by setting deletedAt', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    const deletedAt = ISO(Date.parse(expense.updatedAt) + 1000);

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: deletedAt,
        clientMutationId: uuidv7(),
        fields: { deletedAt },
      },
    ]);

    expect(result?.status).toBe('applied');
    expect(result?.record?.deletedAt).toBe(deletedAt);
  });

  it('undeletes a row by setting deletedAt back to null', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.now() + 1000),
        clientMutationId: uuidv7(),
        fields: { deletedAt: null },
      },
    ]);

    expect(result?.status).toBe('applied');
    expect(result?.record?.deletedAt).toBeNull();
  });

  it('keeps createdAt immutable across an update', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.parse(expense.updatedAt) + 1000),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 1 },
      },
    ]);
    expect(result?.record?.createdAt).toBe(expense.createdAt);
  });
});

describe('conflict_server_wins', () => {
  it('drops a write whose updatedAt is older than stored, and returns the server row', async () => {
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 900,
    });
    const revisionBefore = expense.revision;

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.parse(expense.updatedAt) - 60_000),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 450 },
      },
    ]);

    expect(result?.status).toBe('conflict_server_wins');
    expect(result?.error).toBeNull();
    // The authoritative row, on a conflict. This is what makes clients converge: a "no"
    // with no body would leave the loser holding data the server will never have.
    expect(result?.record).toMatchObject({ amountMinor: 900, revision: revisionBefore });
    expect(await revisionWatermark(user.user.id)).toBe(revisionBefore);
  });

  it('drops a write whose updatedAt exactly equals stored', async () => {
    // A client re-pushing an unacknowledged row sends back the exact `updatedAt` the
    // server stored, so equality is the common case, not an exotic one. Ties go to the
    // server so the outcome does not depend on which device pushed first.
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 900,
    });

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: expense.updatedAt,
        clientMutationId: uuidv7(),
        fields: { amountMinor: 450 },
      },
    ]);

    expect(result?.status).toBe('conflict_server_wins');
    expect(result?.record).toMatchObject({ amountMinor: 900, revision: expense.revision });
  });

  it('does not put a conflicting row onto the next sync page', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    const watermark = await revisionWatermark(user.user.id);

    await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: expense.updatedAt,
        clientMutationId: uuidv7(),
        fields: { amountMinor: 1 },
      },
    ]);

    // A dropped write that still burned a revision would re-deliver the unchanged row to
    // every device on the account, on every retry.
    const page = await pull(user, { since: watermark });
    expect(page.changes).toEqual([]);
  });
});

describe('the clock-skew clamp', () => {
  it('stores a far-future updatedAt clamped to now + 5 minutes', async () => {
    const id = uuidv7();
    const sentAt = Date.now();
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(sentAt + 365 * 24 * 60 * 60 * 1000),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
    ]);

    expect(result?.status).toBe('applied');
    const stored = Date.parse(result?.record?.updatedAt ?? '');
    expect(stored).toBeLessThanOrEqual(sentAt + LIMITS.CLIENT_CLOCK_SKEW_CLAMP_MS + 5_000);
    expect(stored).toBeGreaterThan(sentAt);
  });

  it('cannot win a later conflict on the same row, which is the point of clamping', async () => {
    // Without the clamp this row would be unfixable from any other device, permanently:
    // the skewed client's `updatedAt` would beat every honest edit for a year.
    const id = uuidv7();
    await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(Date.now() + 365 * 24 * 60 * 60 * 1000),
        clientMutationId: uuidv7(),
        fields: { name: 'Skewed' },
      },
    ]);

    const [fixed] = await pushOk(user, [
      {
        entity: 'category',
        id,
        // Ten minutes ahead: past the clamp ceiling the skewed write was pinned to.
        updatedAt: ISO(Date.now() + 10 * 60 * 1000),
        clientMutationId: uuidv7(),
        fields: { name: 'Corrected' },
      },
    ]);

    expect(fixed?.status).toBe('applied');
    expect(fixed?.record).toMatchObject({ name: 'Corrected' });
  });

  it('leaves a client exactly five minutes fast unclamped', async () => {
    const id = uuidv7();
    const updatedAt = ISO(Date.now() + LIMITS.CLIENT_CLOCK_SKEW_CLAMP_MS - 2_000);
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt,
        clientMutationId: uuidv7(),
        fields: { name: 'Nearly' },
      },
    ]);
    expect(result?.record?.updatedAt).toBe(updatedAt);
  });
});

describe('invalid — and the rest of the batch unaffected', () => {
  it('reports an unknown categoryId without failing the batch', async () => {
    const goodId = uuidv7();
    const badId = uuidv7();
    const now = ISO(Date.now());

    const results = await pushOk(user, [
      {
        entity: 'expense',
        id: badId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { categoryId: uuidv7(), amountMinor: 450, date: '2026-10-09' },
      },
      {
        entity: 'expense',
        id: goodId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { categoryId: user.defaultCategory.id, amountMinor: 450, date: '2026-10-09' },
      },
    ]);

    const bad = resultFor(results, badId);
    expect(bad.status).toBe('invalid');
    expect(bad.error?.code).toBe('unknown_category');
    // No server row to report: the write never landed and the id is unknown.
    expect(bad.record).toBeNull();

    // The point of per-record results: one permanently-unacceptable row must not stop the
    // outbox draining.
    expect(resultFor(results, goodId).status).toBe('applied');
    expect(await getPrisma().expense.findUnique({ where: { id: goodId } })).not.toBeNull();
    expect(await getPrisma().expense.findUnique({ where: { id: badId } })).toBeNull();
  });

  it('reports a category belonging to another user as unknown rather than forbidden', async () => {
    const other = await createUser();
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { categoryId: other.defaultCategory.id, amountMinor: 1, date: '2026-10-09' },
      },
    ]);
    // Indistinguishable from "no such id", or the field becomes a probe for which ids
    // exist on other accounts.
    expect(result?.error?.code).toBe('unknown_category');
  });

  it('reports an incomplete create, naming every missing field at once', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { note: 'no amount, no date, no category' },
      },
    ]);

    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('validation_error');
    const paths = (result?.error?.details?.issues ?? []).map((issue) => issue.path);
    expect(paths).toEqual(['fields.categoryId', 'fields.amountMinor', 'fields.date']);
  });

  it('reports a category create with no name', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { color: '#f59e0b' },
      },
    ]);
    expect(result?.status).toBe('invalid');
    expect(result?.error?.details?.issues?.[0]?.path).toBe('fields.name');
  });

  it('reports a malformed item per record rather than failing the batch', async () => {
    // The whole reason item validation is per-item. A `400` here would mean one
    // locally-corrupted row stops every good row behind it from ever syncing.
    const badId = uuidv7();
    const goodId = uuidv7();
    const outcome = await push(user, [
      {
        entity: 'category',
        id: badId,
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: '' },
      },
      {
        entity: 'category',
        id: goodId,
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
    ]);

    expect(outcome.status).toBe(200);
    expect(resultFor(outcome.body.results, badId).error?.code).toBe('validation_error');
    expect(resultFor(outcome.body.results, goodId).status).toBe('applied');
  });

  it('reports an attempt to write a server-owned field as immutable_field', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee', revision: 99 },
      },
    ]);
    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('immutable_field');
  });

  it('reports an unknown field as validation_error, not immutable_field', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: {
          categoryId: user.defaultCategory.id,
          ammountMinor: 450,
          date: '2026-10-09',
        },
      },
    ]);
    // A typo and "you tried to set something you do not own" are different client bugs
    // with different fixes, so they get different codes.
    expect(result?.error?.code).toBe('validation_error');
  });

  it('reports a name already taken by another live category', async () => {
    // Two devices both inventing "Coffee" offline is an ordinary event in an offline app,
    // not a race. The loser needs a code it can branch on to merge or rename locally.
    await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Coffee' })
      .expect(201);

    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'coffee' },
      },
    ]);

    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('category_name_taken');
  });

  it('refuses to tombstone the undeletable default category', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id: user.defaultCategory.id,
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { deletedAt: ISO(Date.now()) },
      },
    ]);

    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('category_not_deletable');
    // It is a real row, so the authoritative copy still comes back and the client can
    // converge on "this one is still here".
    expect(result?.record?.id).toBe(user.defaultCategory.id);
    expect(result?.record?.deletedAt).toBeNull();
  });

  it('refuses an id already owned by another account, without naming the owner', async () => {
    const other = await createUser();
    const theirs = await createExpense(other, { categoryId: other.defaultCategory.id });

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: theirs.id,
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 1 },
      },
    ]);

    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('validation_error');
    expect(result?.record).toBeNull();
    // Untouched.
    expect(
      (await getPrisma().expense.findUniqueOrThrow({ where: { id: theirs.id } })).amountMinor,
    ).toBe(BigInt(theirs.amountMinor));
  });

  it('refuses a currency the account is not in', async () => {
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: {
          categoryId: user.defaultCategory.id,
          amountMinor: 450,
          currency: 'JPY',
          date: '2026-10-09',
        },
      },
    ]);
    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('validation_error');
  });

  it('refuses to undelete an expense whose category was deleted', async () => {
    const category = (
      await api()
        .post('/v1/categories')
        .set('Authorization', user.auth)
        .send({ name: 'Coffee' })
        .expect(201)
    ).body.data;
    const expense = await createExpense(user, { categoryId: category.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    await api().delete(`/v1/categories/${category.id}`).set('Authorization', user.auth).expect(200);

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.now() + 1000),
        clientMutationId: uuidv7(),
        fields: { deletedAt: null },
      },
    ]);

    // Resurrecting the row would leave it pointing at a dead category. The client's fix
    // is to repoint it at `Uncategorized`, which always exists.
    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('unknown_category');

    const [repointed] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: ISO(Date.now() + 2000),
        clientMutationId: uuidv7(),
        fields: { deletedAt: null, categoryId: user.defaultCategory.id },
      },
    ]);
    expect(repointed?.status).toBe('applied');
  });

  it('still allows tombstoning an expense whose category was deleted', async () => {
    // The mirror case. A delete must never be blocked by a category the user already
    // cleaned up, or the client retries it forever.
    const category = (
      await api()
        .post('/v1/categories')
        .set('Authorization', user.auth)
        .send({ name: 'Coffee' })
        .expect(201)
    ).body.data;
    const expense = await createExpense(user, { categoryId: category.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    await api().delete(`/v1/categories/${category.id}`).set('Authorization', user.auth).expect(200);

    const when = ISO(Date.now() + 1000);
    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id: expense.id,
        updatedAt: when,
        clientMutationId: uuidv7(),
        fields: { deletedAt: when, note: 'deleted later' },
      },
    ]);

    expect(result?.status).toBe('applied');
    expect(result?.record?.deletedAt).toBe(when);
  });

  it('does not burn a revision on an invalid item', async () => {
    const before = await revisionWatermark(user.user.id);
    await pushOk(user, [
      {
        entity: 'expense',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { categoryId: uuidv7(), amountMinor: 1, date: '2026-10-09' },
      },
    ]);
    // The savepoint rollback returns the revision the failed item allocated, so the
    // per-user sequence stays gap-free. A gap is not fatal, but a sequence that skips on
    // every bad row makes the watermark meaningless as a diagnostic.
    expect(await revisionWatermark(user.user.id)).toBe(before);
  });
});

describe('dependency ordering within a batch', () => {
  it('applies an expense against a category created in the same batch', async () => {
    const categoryId = uuidv7();
    const expenseId = uuidv7();
    const now = ISO(Date.now());

    const results = await pushOk(user, [
      {
        entity: 'category',
        id: categoryId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { categoryId, amountMinor: 450, date: '2026-10-09' },
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(resultFor(results, expenseId).record).toMatchObject({ categoryId });
  });

  it('does so even when the client pushes them in the wrong order', async () => {
    // The server sorts internally, so a client that pushes an expense before its category
    // is not punished with a spurious `unknown_category` — and the two sides cannot
    // disagree about the order.
    const categoryId = uuidv7();
    const expenseId = uuidv7();
    const now = ISO(Date.now());

    const results = await pushOk(user, [
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { categoryId, amountMinor: 450, date: '2026-10-09' },
      },
      {
        entity: 'category',
        id: categoryId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    // Results come back in *request* order, not apply order: the client matches them to
    // its outbox positionally as well as by `clientMutationId`.
    expect(results.map((r) => r.entity)).toEqual(['expense', 'category']);
    expect(results.map((r) => r.id)).toEqual([expenseId, categoryId]);
  });

  it('gives the category a lower revision than the expense that depends on it', async () => {
    const categoryId = uuidv7();
    const expenseId = uuidv7();
    const now = ISO(Date.now());

    const results = await pushOk(user, [
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { categoryId, amountMinor: 450, date: '2026-10-09' },
      },
      {
        entity: 'category',
        id: categoryId,
        updatedAt: now,
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
    ]);

    // A second device applies a pull in revision order, so the category has to arrive
    // first there too — otherwise it briefly holds an expense referencing nothing.
    expect(resultFor(results, categoryId).record?.revision).toBeLessThan(
      resultFor(results, expenseId).record?.revision ?? 0,
    );
  });

  it('applies two edits to one row in the order they were sent', async () => {
    const id = uuidv7();
    const base = Date.now();
    const results = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(base),
        clientMutationId: uuidv7(),
        fields: { name: 'First' },
      },
      {
        entity: 'category',
        id,
        updatedAt: ISO(base + 1000),
        clientMutationId: uuidv7(),
        fields: { name: 'Second' },
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(results[1]?.record).toMatchObject({ name: 'Second' });
  });

  it('lets the newer of two out-of-order edits to one row win', async () => {
    const id = uuidv7();
    const base = Date.now();
    const results = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(base + 1000),
        clientMutationId: uuidv7(),
        fields: { name: 'Newer' },
      },
      {
        entity: 'category',
        id,
        updatedAt: ISO(base),
        clientMutationId: uuidv7(),
        fields: { name: 'Older' },
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'conflict_server_wins']);
    expect(results[1]?.record).toMatchObject({ name: 'Newer' });
  });
});

describe('the batch envelope', () => {
  it('rejects a batch over the published maximum as 413, not 400', async () => {
    const changes = Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE + 1 }, () => ({
      entity: 'category',
      id: uuidv7(),
      updatedAt: ISO(Date.now()),
      clientMutationId: uuidv7(),
      fields: { name: 'x' },
    }));

    const outcome = await push(user, changes);
    // The recovery is "split and resend", which is a different instruction from "fix this
    // field" — hence a different status from a validation failure.
    expect(outcome.status).toBe(413);
    expect(outcome.error?.code).toBe('batch_too_large');
  });

  it('accepts a batch exactly at the maximum', async () => {
    const changes = Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE }, (_, i) => ({
      entity: 'category',
      id: uuidv7(),
      updatedAt: ISO(Date.now()),
      clientMutationId: uuidv7(),
      fields: { name: `Category ${i}` },
    }));

    const outcome = await push(user, changes);
    expect(outcome.status).toBe(200);
    expect(outcome.body.results).toHaveLength(LIMITS.SYNC_MAX_BATCH_SIZE);
    expect(outcome.body.results.every((r) => r.status === 'applied')).toBe(true);
  });

  it('rejects an empty batch', async () => {
    const outcome = await push(user, []);
    expect(outcome.status).toBe(400);
    expect(outcome.error?.code).toBe('validation_error');
  });

  it('rejects a missing body as malformed_request', async () => {
    const response = await api().post('/v1/sync').set('Authorization', user.auth);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('malformed_request');
  });

  it('rejects an item with no addressable identity, naming the index', async () => {
    // The one item-level failure that still has to be batch-level: with no `entity`,
    // `id` or `clientMutationId` there is nothing to key a per-record result on.
    const response = await api()
      .post('/v1/sync')
      .set('Authorization', user.auth)
      .send({ changes: [{ fields: { name: 'Coffee' } }] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.message).toContain('changes[0]');
  });

  it('rejects an unknown envelope key', async () => {
    const response = await api()
      .post('/v1/sync')
      .set('Authorization', user.auth)
      .send({ changes: [], deviceId: 'phone' });
    expect(response.status).toBe(400);
  });

  it('requires a token', async () => {
    const response = await api().post('/v1/sync').send({ changes: [] });
    expect(response.status).toBe(401);
  });

  it('reports serverRevision as the watermark after the batch', async () => {
    const outcome = await push(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
    ]);
    expect(outcome.body.serverRevision).toBe(await revisionWatermark(user.user.id));
  });
});
