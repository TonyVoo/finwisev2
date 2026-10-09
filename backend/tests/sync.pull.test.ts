import { LIMITS } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { getPrisma } from '../src/db/client.ts';
import { pruneTombstones } from '../src/services/tombstoneService.ts';
import { createExpense, createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { changeFor, pull, pullAll, pushOk } from './support/sync.ts';

/**
 * `GET /v1/sync` — the pull side.
 *
 * The failure this suite exists to catch is the quiet one. A pull that returns the wrong
 * *shape* breaks a build; a pull that silently skips one row advances the cursor past it
 * and that device never sees it again, with no error anywhere. So the paging tests below
 * check a stronger property than "the page looks right": every changed row is delivered
 * exactly once across the whole walk, with the client following the documented
 * `since = nextCursor` loop.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

describe('a full download', () => {
  it('returns every row from since=0, ordered by revision', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });

    const page = await pull(user, { since: 0 });

    const revisions = page.changes.map((change) => change.record.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    // Six seeded categories plus the expense.
    expect(page.changes.filter((c) => c.entity === 'category')).toHaveLength(6);
    expect(changeFor(page.changes, expense.id)?.entity).toBe('expense');
    expect(page.resyncRequired).toBe(false);
    expect(page.hasMore).toBe(false);
  });

  it('treats an omitted since as 0', async () => {
    const withoutSince = await pull(user);
    const withZero = await pull(user, { since: 0 });
    expect(withoutSince.changes.map((c) => c.record.id)).toEqual(
      withZero.changes.map((c) => c.record.id),
    );
  });

  it('reports nextCursor as the highest revision in the page', async () => {
    const page = await pull(user, { since: 0 });
    const highest = Math.max(...page.changes.map((c) => c.record.revision));
    expect(page.nextCursor).toBe(highest);
    expect(page.nextCursor).toBe(await revisionWatermark(user.user.id));
  });

  it('carries both entities in one stream, discriminated on entity', async () => {
    await createExpense(user, { categoryId: user.defaultCategory.id });
    const page = await pull(user, { since: 0 });
    expect(new Set(page.changes.map((c) => c.entity))).toEqual(new Set(['category', 'expense']));
  });
});

describe('an up-to-date client', () => {
  it('gets an empty page that echoes the since it sent', async () => {
    const watermark = await revisionWatermark(user.user.id);
    const page = await pull(user, { since: watermark });

    expect(page.changes).toEqual([]);
    expect(page.hasMore).toBe(false);
    // Echoed rather than zeroed, so a client can store `nextCursor` unconditionally.
    expect(page.nextCursor).toBe(watermark);
    expect(page.resyncRequired).toBe(false);
  });

  it('sees only what changed after its watermark', async () => {
    const watermark = await revisionWatermark(user.user.id);
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });

    const page = await pull(user, { since: watermark });
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]?.record.id).toBe(expense.id);
  });
});

describe('paging', () => {
  it('delivers every changed row exactly once across pages, skipping none at a boundary', async () => {
    // The row that gets lost to an off-by-one lands exactly on a page boundary, so this
    // uses a page size that does not divide the row count evenly and then checks the
    // multiset of delivered ids against the truth in the database.
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const expense = await createExpense(user, {
        categoryId: user.defaultCategory.id,
        date: '2026-10-06',
      });
      ids.push(expense.id);
    }

    const walk = await pullAll(user, { limit: 3 });

    expect(walk.pages).toBeGreaterThan(1);
    const delivered = walk.changes.map((c) => c.record.id);
    // Exactly once: a duplicate would mean a cursor that failed to advance, and a
    // missing id a cursor that advanced too far.
    expect(new Set(delivered).size).toBe(delivered.length);
    // Six seeded categories + seven expenses.
    expect(delivered).toHaveLength(13);
    for (const id of ids) expect(delivered).toContain(id);
    expect(walk.cursor).toBe(await revisionWatermark(user.user.id));
  });

  it('keeps the global revision order across page boundaries', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createExpense(user, { categoryId: user.defaultCategory.id });
    }
    const walk = await pullAll(user, { limit: 2 });
    const revisions = walk.changes.map((c) => c.record.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
  });

  it('sets hasMore only while more exists, and nextCursor to the last row of the page', async () => {
    const first = await pull(user, { since: 0, limit: 2 });
    expect(first.changes).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(first.changes[1]?.record.revision);

    const last = await pull(user, { since: 0, limit: LIMITS.SYNC_PULL_MAX_LIMIT });
    expect(last.hasMore).toBe(false);
  });

  it('does not re-deliver a row whose revision equals the cursor', async () => {
    const first = await pull(user, { since: 0, limit: 2 });
    const second = await pull(user, { since: first.nextCursor, limit: 2 });
    const overlap = second.changes.filter((c) =>
      first.changes.some((f) => f.record.id === c.record.id),
    );
    // The predicate is `revision > since`, not `>=`. Inclusive would re-send the boundary
    // row on every page, which is harmless but means a client never finishes.
    expect(overlap).toEqual([]);
  });

  it('delivers a row written between two pages, because revisions only ever increase', async () => {
    const first = await pull(user, { since: 0, limit: 3 });
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });

    const walk = await pullAll(user, { limit: 3, from: first.nextCursor });
    expect(walk.changes.map((c) => c.record.id)).toContain(expense.id);
  });

  it('rejects a limit outside the published bounds', async () => {
    for (const limit of [0, LIMITS.SYNC_PULL_MAX_LIMIT + 1, -1]) {
      const response = await api().get(`/v1/sync?limit=${limit}`).set('Authorization', user.auth);
      expect(response.status, `limit=${limit}`).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });

  it('rejects a since that is not a non-negative integer', async () => {
    for (const since of ['-1', 'abc', '1.5']) {
      const response = await api().get(`/v1/sync?since=${since}`).set('Authorization', user.auth);
      expect(response.status, `since=${since}`).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    // The query schema is strict. A client that typo'd `sinse` would otherwise get a
    // silent full re-download on every poll and never find out.
    const response = await api().get('/v1/sync?sinse=4').set('Authorization', user.auth);
    expect(response.status).toBe(400);
  });
});

describe('tombstones', () => {
  it('carries a delete as a row with deletedAt set', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    const watermark = await revisionWatermark(user.user.id);

    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);

    const page = await pull(user, { since: watermark });
    const change = changeFor(page.changes, expense.id);
    expect(change?.record.deletedAt).not.toBeNull();
    expect(change?.record.revision).toBeGreaterThan(watermark);
  });

  it('includes a tombstone in a full download, so a fresh client learns the row is gone', async () => {
    // Needed for the second device in a two-device pair: it has the live row already and
    // only a tombstone can tell it to drop it. A pull that filtered `deletedAt` would
    // leave that device showing a deleted expense forever.
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);

    const page = await pull(user, { since: 0 });
    expect(changeFor(page.changes, expense.id)?.record.deletedAt).not.toBeNull();
  });

  it('delivers a category tombstone ahead of the expenses it reassigned', async () => {
    const category = (
      await api()
        .post('/v1/categories')
        .set('Authorization', user.auth)
        .send({ name: 'Coffee' })
        .expect(201)
    ).body.data;
    const expense = await createExpense(user, { categoryId: category.id });
    const watermark = await revisionWatermark(user.user.id);

    await api().delete(`/v1/categories/${category.id}`).set('Authorization', user.auth).expect(200);

    const page = await pull(user, { since: watermark });
    const categoryChange = changeFor(page.changes, category.id);
    const expenseChange = changeFor(page.changes, expense.id);
    expect(categoryChange?.record.deletedAt).not.toBeNull();
    // The client applies a pull in revision order, so the tombstone has to arrive before
    // the reassignment that depends on it.
    expect(categoryChange?.record.revision).toBeLessThan(expenseChange?.record.revision ?? 0);
    expect(expenseChange?.record.deletedAt).toBeNull();
  });
});

describe('the 90-day tombstone horizon', () => {
  /** Backdate a tombstone so the pruner will take it, without waiting 90 days. */
  async function backdateTombstone(expenseId: string, daysAgo: number): Promise<void> {
    const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await getPrisma().expense.update({
      where: { id: expenseId },
      data: { deletedAt: when, updatedAt: when },
    });
  }

  it('prunes a tombstone past the horizon and advances the watermark', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    const tombstoneRevision = (
      await getPrisma().expense.findUniqueOrThrow({
        where: { id: expense.id },
      })
    ).revision;
    await backdateTombstone(expense.id, 91);

    const result = await pruneTombstones(getPrisma(), user.user.id);

    expect(result.expenses).toBe(1);
    expect(result.prunedThroughRevision).toBe(tombstoneRevision);
    expect(await getPrisma().expense.findUnique({ where: { id: expense.id } })).toBeNull();
  });

  it('leaves a tombstone inside the horizon alone', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    await backdateTombstone(expense.id, 89);

    const result = await pruneTombstones(getPrisma(), user.user.id);

    expect(result.expenses).toBe(0);
    expect(result.prunedThroughRevision).toBe(0);
    expect(await getPrisma().expense.findUnique({ where: { id: expense.id } })).not.toBeNull();
  });

  it('answers resyncRequired to a since below the pruned watermark', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    const beforeDelete = await revisionWatermark(user.user.id);
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    await backdateTombstone(expense.id, 91);
    await pruneTombstones(getPrisma(), user.user.id);

    // This cursor is what a client that went offline before the delete is holding. The
    // tombstone that would have told it about the delete no longer exists.
    const page = await pull(user, { since: beforeDelete });

    expect(page.resyncRequired).toBe(true);
    // The other fields are pinned so a client cannot half-apply a page it is about to
    // throw away.
    expect(page.changes).toEqual([]);
    expect(page.nextCursor).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it('still serves a client at or above the pruned watermark incrementally', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    await backdateTombstone(expense.id, 91);
    const { prunedThroughRevision } = await pruneTombstones(getPrisma(), user.user.id);

    const page = await pull(user, { since: prunedThroughRevision });
    expect(page.resyncRequired).toBe(false);
  });

  it('never answers resyncRequired to since=0, so a resync cannot loop', async () => {
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth).expect(200);
    await backdateTombstone(expense.id, 91);
    await pruneTombstones(getPrisma(), user.user.id);

    const page = await pull(user, { since: 0 });
    expect(page.resyncRequired).toBe(false);
    expect(page.changes.length).toBeGreaterThan(0);
  });

  it('answers resyncRequired to a cursor above the current watermark', async () => {
    // A watermark from a database that no longer exists — a restore from backup, or a
    // reset environment. Every later pull would come back empty and the client would
    // never learn it is stranded.
    const page = await pull(user, { since: (await revisionWatermark(user.user.id)) + 1 });
    expect(page.resyncRequired).toBe(true);
  });

  it('prunes a category and its expense tombstones in one pass', async () => {
    // Expenses are deleted before categories *in the same transaction*, so the category's
    // `NOT EXISTS` guard already sees its expenses gone. Both go in one run, which is the
    // common case: a category delete reassigns the live expenses, so anything still
    // pointing at the category was tombstoned before it and is therefore older.
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

    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await getPrisma().expense.update({ where: { id: expense.id }, data: { deletedAt: old } });
    await getPrisma().category.update({ where: { id: category.id }, data: { deletedAt: old } });

    const result = await pruneTombstones(getPrisma(), user.user.id);

    expect(result.expenses).toBe(1);
    expect(result.categories).toBe(1);
    expect(result.categoriesRetained).toBe(0);
    expect(await getPrisma().category.findUnique({ where: { id: category.id } })).toBeNull();
  });

  it('retains a stale category tombstone while an expense inside the horizon references it', async () => {
    // The FK is `ON DELETE RESTRICT` deliberately: a tombstoned expense keeps pointing at
    // the category it had when it was deleted, and cascading the category away would
    // destroy spend history to tidy up a category. So the category waits.
    //
    // The ordering that gets here is real rather than contrived: a client can push a
    // delete for an expense that still references a category deleted long ago, which
    // leaves the expense tombstone *newer* than the category's.
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

    await getPrisma().category.update({
      where: { id: category.id },
      data: { deletedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });
    await getPrisma().expense.update({
      where: { id: expense.id },
      data: { deletedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    });

    const first = await pruneTombstones(getPrisma(), user.user.id);
    expect(first.expenses).toBe(0);
    expect(first.categories).toBe(0);
    expect(first.categoriesRetained).toBe(1);
    expect(await getPrisma().category.findUnique({ where: { id: category.id } })).not.toBeNull();
    // Nothing was destroyed, so no client is stranded for a cleanup that did not happen.
    expect(first.prunedThroughRevision).toBe(0);

    // Once the expense tombstone passes the horizon too, both go.
    await getPrisma().expense.update({
      where: { id: expense.id },
      data: { deletedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });
    const second = await pruneTombstones(getPrisma(), user.user.id);
    expect(second.expenses).toBe(1);
    expect(second.categories).toBe(1);
    expect(await getPrisma().category.findUnique({ where: { id: category.id } })).toBeNull();
  });

  it('does not touch tombstones belonging to another user', async () => {
    const other = await createUser();
    const mine = await createExpense(user, { categoryId: user.defaultCategory.id });
    const theirs = await createExpense(other, { categoryId: other.defaultCategory.id });
    for (const [owner, expense] of [
      [user, mine],
      [other, theirs],
    ] as const) {
      await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', owner.auth).expect(200);
      await getPrisma().expense.update({
        where: { id: expense.id },
        data: { deletedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
      });
    }

    await pruneTombstones(getPrisma(), user.user.id);

    expect(await getPrisma().expense.findUnique({ where: { id: mine.id } })).toBeNull();
    expect(await getPrisma().expense.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    const otherCounter = await getPrisma().revisionCounter.findUniqueOrThrow({
      where: { userId: other.user.id },
    });
    expect(otherCounter.prunedThroughRevision).toBe(0);
  });
});

describe('tenancy', () => {
  it('never returns rows belonging to another user', async () => {
    const other = await createUser();
    const theirs = await createExpense(other, { categoryId: other.defaultCategory.id });

    const page = await pull(user, { since: 0 });
    expect(changeFor(page.changes, theirs.id)).toBeUndefined();
    expect(changeFor(page.changes, other.defaultCategory.id)).toBeUndefined();
  });

  it('requires a token', async () => {
    const response = await api().get('/v1/sync');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('runs on an independent revision sequence per user', async () => {
    // Revisions are per-user, so a second account's writes must not advance
    // this one's cursor. A global sequence would make every client re-pull on every write
    // by any other user.
    const watermark = await revisionWatermark(user.user.id);
    const other = await createUser();
    await createExpense(other, { categoryId: other.defaultCategory.id });

    const page = await pull(user, { since: watermark });
    expect(page.changes).toEqual([]);
    expect(page.resyncRequired).toBe(false);
  });
});

describe('serverTime', () => {
  it('is an RFC 3339 instant and not a cursor', async () => {
    const page = await pull(user, { since: 0 });
    expect(new Date(page.serverTime).toISOString()).toBe(page.serverTime);
    expect(typeof page.nextCursor).toBe('number');
  });
});

describe('a push and a pull agree', () => {
  it('delivers rows written through POST /v1/sync on the next pull', async () => {
    const watermark = await revisionWatermark(user.user.id);
    const categoryId = uuidv7();
    const expenseId = uuidv7();
    const now = new Date().toISOString();

    await pushOk(user, [
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

    const page = await pull(user, { since: watermark });
    expect(page.changes.map((c) => c.record.id)).toEqual([categoryId, expenseId]);
  });
});
