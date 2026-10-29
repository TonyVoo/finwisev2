import { LIMITS } from '@expense-tracker/shared';
import type { Expense, SyncPushItem } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneTombstones } from '../src/services/tombstoneService.ts';
import { CLOCK_SKEW_CLAMP_MS, clampClientUpdatedAt, decideLww } from '../src/sync/resolver.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { changeFor, pull, pullAll, push, pushItem, pushOk, resultFor } from './support/sync.ts';

/**
 * §8 of `docs/qa/TEST_PLAN.md`, API layer: the fifteen cases the ledger listed as having
 * neither a test naming them nor a recorded `**Result**`.
 *
 * `SYNC-07`–`SYNC-38` here overlap `sync.push.test.ts`, `sync.pull.test.ts`,
 * `sync.idempotency.test.ts` and `sync.batch.test.ts` the same way `plan.auth.test.ts`
 * overlaps the endpoint suites, and for the same reason: those were written against the
 * endpoints, and these are written against the plan's own `**Expect**` clauses, which
 * name things the endpoint suites do not. The plan's §1 rule is that an automated case
 * **names its own id in the test file**, because the id is the handle a bug report and a
 * fixer's first grep both use. Fifteen of these cases were behaviourally covered and
 * untraceable, which answers that grep with a document instead of a test.
 *
 * One case in this range is executed at the unit layer on purpose and says so:
 * `SYNC-19`'s second clause is not reachable over HTTP. See the comment on it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** An expense push item, with the three fields a create needs. */
function expenseItem(
  categoryId: string,
  overrides: {
    id?: string;
    updatedAt?: string;
    clientMutationId?: string;
    amountMinor?: number;
    date?: string;
    note?: string | null;
  } = {},
): SyncPushItem {
  const { id, updatedAt, clientMutationId, ...fields } = overrides;
  return pushItem({
    entity: 'expense',
    id: id ?? uuidv7(),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(clientMutationId === undefined ? {} : { clientMutationId }),
    fields: {
      categoryId,
      amountMinor: fields.amountMinor ?? 450,
      date: fields.date ?? '2026-10-06',
      ...(fields.note === undefined ? {} : { note: fields.note }),
    },
  } as Parameters<typeof pushItem>[0]);
}

/**
 * Put a row on the server at a chosen `updatedAt`, through the sync path.
 *
 * The REST create stamps `updatedAt` from the server clock, so a case that needs a
 * *specific* stored `updatedAt` — most of the last-write-wins cases — has to establish
 * the row through a push. Timestamps in the past are stored verbatim; only the future is
 * clamped.
 */
async function seedExpenseAt(
  user: TestUser,
  categoryId: string,
  updatedAt: string,
  amountMinor: number,
): Promise<{ id: string; record: Expense }> {
  const id = uuidv7();
  const results = await pushOk(user, [expenseItem(categoryId, { id, updatedAt, amountMinor })]);
  const result = resultFor(results, id);
  expect(result.status).toBe('applied');
  expect(result.record).not.toBeNull();
  return { id, record: result.record as Expense };
}

describe('SYNC-07 — the loser of a conflict is overwritten with the server row', () => {
  it('answers conflict_server_wins with the authoritative record, not null', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    // The server row: 14:30, amountMinor 900.
    const { id, record: seeded } = await seedExpenseAt(
      user,
      category,
      '2026-10-06T14:30:00.000Z',
      900,
    );

    // The losing push: an hour and a half older, a different amount.
    const results = await pushOk(user, [
      expenseItem(category, {
        id,
        updatedAt: '2026-10-06T13:05:00.000Z',
        amountMinor: 450,
      }),
    ]);
    const result = resultFor(results, id);

    expect(result.status).toBe('conflict_server_wins');
    expect(result.idempotentReplay).toBe(false);
    expect(result.error).toBeNull();

    // The whole point of the case: a conflict with `record: null` leaves the client
    // nothing to converge on, so it would keep its losing copy forever.
    expect(result.record).not.toBeNull();
    const record = result.record as Expense;
    expect(record.amountMinor).toBe(900);
    expect(record.updatedAt).toBe('2026-10-06T14:30:00.000Z');
    expect(record.revision).toBe(seeded.revision);

    // And the stored row really is unchanged.
    const fresh = await pull(user, { since: 0 });
    const change = changeFor(fresh.changes, id);
    expect((change?.record as Expense).amountMinor).toBe(900);
  });
});

describe('SYNC-08 — an equal updatedAt is a conflict, not an apply', () => {
  it('gives the tie to the server, so arrival order cannot change the outcome', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;
    const T = '2026-10-06T14:30:00.000Z';

    const { id } = await seedExpenseAt(user, category, T, 900);

    const results = await pushOk(user, [
      expenseItem(category, { id, updatedAt: T, amountMinor: 123 }),
    ]);
    const result = resultFor(results, id);

    // `applied` here would mean the resolver uses `>=` where it needs `>`, and two
    // devices pushing identical timestamps would diverge on who arrived first.
    expect(result.status).toBe('conflict_server_wins');
    expect((result.record as Expense).amountMinor).toBe(900);
  });
});

describe('SYNC-09 — a byte-identical retry replays the original result', () => {
  it('replays without rewriting the row, and the row is listed exactly once', async () => {
    const user = await createUser();
    const id = uuidv7();
    const body = {
      changes: [
        expenseItem(user.defaultCategory.id, {
          id,
          updatedAt: '2026-10-06T14:30:00.000Z',
          clientMutationId: uuidv7(),
          amountMinor: 777,
        }),
      ],
    };

    const send = () => api().post('/v1/sync').set('Authorization', user.auth).send(body);

    const first = await send();
    expect(first.status).toBe(200);
    const firstResult = resultFor(first.body.results, id);
    expect(firstResult.status).toBe('applied');
    expect(firstResult.idempotentReplay).toBe(false);

    // The byte-identical retry: what a client does when the response was dropped.
    const second = await send();
    expect(second.status).toBe(200);
    const secondResult = resultFor(second.body.results, id);
    expect(secondResult.status).toBe('applied');
    expect(secondResult.idempotentReplay).toBe(true);

    // A bumped revision would mean the row was written a second time.
    expect(secondResult.record).toEqual(firstResult.record);
    expect((secondResult.record as Expense).revision).toBe(
      (firstResult.record as Expense).revision,
    );
    expect(second.body.serverRevision).toBe(first.body.serverRevision);

    const listed = await pull(user, { since: 0 });
    expect(listed.changes.filter((c) => c.record.id === id)).toHaveLength(1);
  });
});

describe('SYNC-11 — a reused mutation id with a changed payload is rejected, loudly', () => {
  it('answers mutation_id_reused and still hands back the stored row', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;
    const id = uuidv7();
    const M = uuidv7();

    const first = await pushOk(user, [
      expenseItem(category, { id, clientMutationId: M, amountMinor: 450 }),
    ]);
    expect(resultFor(first, id).status).toBe('applied');

    const second = await pushOk(user, [
      expenseItem(category, { id, clientMutationId: M, amountMinor: 999 }),
    ]);
    const result = resultFor(second, id);

    expect(result.status).toBe('invalid');
    expect(result.error?.code).toBe('mutation_id_reused');

    // Not incidental: the contract says `record` is null only when there is no server
    // row to report, so an `invalid` over an existing row still carries the
    // authoritative copy. A drain that keys its write-back on `status` throws it away
    // and leaves the local row diverged with nothing pending to correct it — drain rule
    // 2 in §8.10.
    expect(result.record).not.toBeNull();
    expect((result.record as Expense).amountMinor).toBe(450);
  });
});

describe('SYNC-12 — idempotency is scoped per user', () => {
  it('lets two users use the same clientMutationId, both applied', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()]);
    const M = uuidv7();

    const aId = uuidv7();
    const bId = uuidv7();

    const aResults = await pushOk(a, [
      pushItem({ entity: 'category', id: aId, clientMutationId: M, fields: { name: 'A-only' } }),
    ]);
    const bResults = await pushOk(b, [
      pushItem({ entity: 'category', id: bId, clientMutationId: M, fields: { name: 'B-only' } }),
    ]);

    for (const [results, id] of [
      [aResults, aId],
      [bResults, bId],
    ] as const) {
      const result = resultFor(results, id);
      expect(result.status).toBe('applied');
      expect(result.idempotentReplay).toBe(false);
    }
  });
});

describe('SYNC-13 — how long a mutation id is remembered', () => {
  it('replays at 89 days and forgets at 91, which is the behaviour change', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;
    const db = getPrisma();

    const id = uuidv7();
    const M = uuidv7();
    const item = expenseItem(category, {
      id,
      clientMutationId: M,
      updatedAt: '2026-10-06T14:30:00.000Z',
      amountMinor: 450,
    });

    const first = resultFor(await pushOk(user, [item]), id);
    expect(first.status).toBe('applied');
    const firstRevision = (first.record as Expense).revision;

    // Inside the window. The ledger row is 89 days old, so it survives the sweep and
    // the replay returns the recorded outcome, applying nothing a second time.
    const insideWindow = new Date(Date.now() + 89 * DAY_MS);
    await pruneTombstones(db, user.user.id, insideWindow);

    const replayed = resultFor(await pushOk(user, [item]), id);
    expect(replayed.status).toBe('applied');
    expect(replayed.idempotentReplay).toBe(true);
    expect((replayed.record as Expense).revision).toBe(firstRevision);

    // Past the window. The id has been forgotten, so the same push is processed as a
    // *new* mutation rather than replayed — the reason 90 days is in the contract.
    const pastWindow = new Date(Date.now() + 91 * DAY_MS);
    const pruned = await pruneTombstones(db, user.user.id, pastWindow);
    expect(pruned.ledgerEntries).toBeGreaterThanOrEqual(1);

    const forgotten = resultFor(await pushOk(user, [item]), id);
    expect(forgotten.idempotentReplay).toBe(false);
    // Processed fresh, and `updatedAt` now ties the stored row, so last-write-wins
    // gives it to the server. The point is that it was *decided* again, not replayed.
    expect(forgotten.status).toBe('conflict_server_wins');
  });
});

describe('SYNC-16 — a stale cursor triggers a resync rather than resurrecting rows', () => {
  it('answers resyncRequired to a pruned cursor and to one above the watermark', async () => {
    const user = await createUser();
    const db = getPrisma();

    // A tombstone, then a prune past the horizon, which is what advances
    // `prunedThroughRevision` — the horizon expressed in the only unit a cursor knows.
    const doomed = await createExpense(user, { categoryId: user.defaultCategory.id });
    const deleted = await api().delete(`/v1/expenses/${doomed.id}`).set('Authorization', user.auth);
    expect(deleted.status).toBe(200);

    const pruneResult = await pruneTombstones(db, user.user.id, new Date(Date.now() + 91 * DAY_MS));
    expect(pruneResult.expenses).toBe(1);
    expect(pruneResult.prunedThroughRevision).toBeGreaterThan(0);

    const serverRevision = await revisionWatermark(user.user.id);

    // 1. A cursor below the pruned watermark: the delete it needs no longer exists.
    const stale = await pull(user, { since: 1 });
    // 2. A cursor above the server's own watermark: a restore from a database that is
    //    gone. Every later pull would come back empty and the client never learns.
    const impossible = await pull(user, { since: serverRevision + 1000 });

    for (const response of [stale, impossible]) {
      expect(response.resyncRequired).toBe(true);
      expect(response.changes).toEqual([]);
      expect(response.nextCursor).toBe(0);
      expect(response.hasMore).toBe(false);
    }
  });
});

describe('SYNC-19 — a clamped push can legitimately come back as a conflict', () => {
  it('applies when the clamped value still beats the stored one', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    // A server row two minutes in the future — itself within the clamp, so stored
    // verbatim.
    const { id } = await seedExpenseAt(
      user,
      category,
      new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      900,
    );

    // A skewed client, six hours fast. Clamped to now + 5 min, which is still newer
    // than now + 2 min, so it lands.
    const results = await pushOk(user, [
      expenseItem(category, {
        id,
        updatedAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        amountMinor: 450,
      }),
    ]);
    const result = resultFor(results, id);

    expect(result.status).toBe('applied');
    const record = result.record as Expense;
    expect(record.amountMinor).toBe(450);

    // The stored timestamp is the clamped one, never the raw +6h: the server never
    // stores a timestamp it does not believe.
    const stored = Date.parse(record.updatedAt);
    expect(stored).toBeLessThanOrEqual(Date.now() + CLOCK_SKEW_CLAMP_MS + 1000);
  });

  /**
   * The case's second clause — "repeat with a server row at `now + 5 min`: the clamped
   * incoming value is then **equal**, so `conflict_server_wins`" — is **not reachable
   * over HTTP**, and this is the honest place to say so rather than write a flaky test.
   *
   * The clamp ceiling is `now + 5 min` evaluated per request. A stored row can therefore
   * be at most `T1 + 5 min` for the request that wrote it, and a later push clamps to
   * `T2 + 5 min` with `T2 > T1` — strictly greater, so it applies. Equality needs both
   * requests to land in the same millisecond, which is a coin toss, not a test.
   *
   * The clause is a claim about the resolver, and the resolver is pure (`GAP 8` was
   * closed by making it so, explicitly to make this boundary reachable "without a
   * fixture per case"). So it is asserted here at the layer where it is deterministic.
   */
  it('gives the tie to the server when the clamp lands exactly on the stored value', () => {
    const now = new Date('2026-10-22T09:00:00.000Z');
    const skewed = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    const clamped = clampClientUpdatedAt(skewed, now);
    expect(clamped.getTime()).toBe(now.getTime() + CLOCK_SKEW_CLAMP_MS);

    // The stored row sits exactly on the ceiling the incoming value clamps to.
    expect(decideLww({ incomingUpdatedAt: clamped, storedUpdatedAt: clamped })).toBe(
      'conflict_server_wins',
    );
    // One millisecond below it, and the clamped push wins — so the tie is the boundary,
    // not an off-by-one swallowing a whole range.
    expect(
      decideLww({
        incomingUpdatedAt: clamped,
        storedUpdatedAt: new Date(clamped.getTime() - 1),
      }),
    ).toBe('applied');
  });
});

describe('SYNC-20 — a device hours behind is not silently ignored forever', () => {
  it('loses the conflict, and the losing push costs neither a field nor a revision', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    const todayish = new Date(Date.now() - 60 * 1000).toISOString();
    const { id, record: seeded } = await seedExpenseAt(user, category, todayish, 900);

    const watermarkBefore = await revisionWatermark(user.user.id);

    const results = await pushOk(user, [
      expenseItem(category, {
        id,
        updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        amountMinor: 450,
      }),
    ]);
    const result = resultFor(results, id);

    // The user on the badly-behind device loses that edit with no notice:
    // `02-offline-and-sync.md` §5.2 deliberately does not notify on this status.
    expect(result.status).toBe('conflict_server_wins');
    const record = result.record as Expense;
    expect(record.amountMinor).toBe(900);
    expect(record.updatedAt).toBe(seeded.updatedAt);
    expect(record.revision).toBe(seeded.revision);

    // A conflict must not cost a sync page.
    expect(await revisionWatermark(user.user.id)).toBe(watermarkBefore);
  });
});

describe('SYNC-22 — the server sorts the batch itself, so client order cannot break it', () => {
  it('applies the category first even when the expense is sent first', async () => {
    const user = await createUser();
    const categoryId = uuidv7();
    const expenseId = uuidv7();

    // Deliberately the wrong way round: the expense references a category that does not
    // exist yet and is second in the batch.
    const results = await pushOk(user, [
      expenseItem(categoryId, { id: expenseId, amountMinor: 450 }),
      pushItem({ entity: 'category', id: categoryId, fields: { name: 'Out of order' } }),
    ]);

    expect(resultFor(results, expenseId).status).toBe('applied');
    expect(resultFor(results, categoryId).status).toBe('applied');

    // `results` comes back in *request* order, so a client can match positionally as
    // well as by `clientMutationId`.
    expect(results.map((r) => r.id)).toEqual([expenseId, categoryId]);
    expect(results.map((r) => r.entity)).toEqual(['expense', 'category']);
  });
});

describe('SYNC-24 — batch size limit', () => {
  it('takes 500, refuses 501 with batch_too_large, and refuses an empty batch', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    const batch = (n: number): SyncPushItem[] =>
      Array.from({ length: n }, () => expenseItem(category));

    const max = await push(user, batch(LIMITS.SYNC_MAX_BATCH_SIZE));
    expect(max.status).toBe(200);
    expect(max.body.results).toHaveLength(LIMITS.SYNC_MAX_BATCH_SIZE);

    const watermarkBefore = await revisionWatermark(user.user.id);

    const tooBig = await push(user, batch(LIMITS.SYNC_MAX_BATCH_SIZE + 1));
    expect(tooBig.status).toBe(413);
    expect(tooBig.error?.code).toBe('batch_too_large');
    // "and no item applied" — the whole batch is refused, not the first 500 of it.
    expect(await revisionWatermark(user.user.id)).toBe(watermarkBefore);

    const empty = await push(user, []);
    expect(empty.status).toBe(400);
    expect(empty.error?.code).toBe('validation_error');
  });
});

describe('SYNC-28 — one bad row does not fail the batch', () => {
  it('applies the two valid rows and flags only the middle one', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    const firstId = uuidv7();
    const badId = uuidv7();
    const lastId = uuidv7();

    const results = await pushOk(user, [
      expenseItem(category, { id: firstId, amountMinor: 100 }),
      expenseItem(uuidv7(), { id: badId, amountMinor: 200 }),
      expenseItem(category, { id: lastId, amountMinor: 300 }),
    ]);

    // Three results, in request order.
    expect(results.map((r) => r.id)).toEqual([firstId, badId, lastId]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'invalid', 'applied']);

    const bad = resultFor(results, badId);
    expect(bad.error?.code).toBe('unknown_category');
    // No server row to report, so this is the one case where `record` is legitimately
    // null.
    expect(bad.record).toBeNull();

    // The two valid rows really are stored. A rollback would wedge the client's outbox
    // forever behind one permanently-unacceptable row.
    const listed = await pull(user, { since: 0 });
    expect(changeFor(listed.changes, firstId)).toBeDefined();
    expect(changeFor(listed.changes, lastId)).toBeDefined();
    expect(changeFor(listed.changes, badId)).toBeUndefined();
  });
});

describe('SYNC-29 — an incomplete create is invalid, and a partial update is not', () => {
  it('needs a complete create, merges a partial update, and rejects empty fields', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    // 1. A row the server has never seen, with only a note.
    const newId = uuidv7();
    const incomplete = await pushOk(user, [
      pushItem({ entity: 'expense', id: newId, fields: { note: 'hello' } }),
    ]);
    expect(resultFor(incomplete, newId).status).toBe('invalid');
    expect(resultFor(incomplete, newId).record).toBeNull();

    // 2. The same shape against a row that exists: absent keys are left alone.
    const existing = await createExpense(user, {
      categoryId: category,
      amountMinor: 1234,
      date: '2026-10-06',
    });
    const partial = await pushOk(user, [
      pushItem({
        entity: 'expense',
        id: existing.id,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
        fields: { note: 'hello' },
      }),
    ]);
    const merged = resultFor(partial, existing.id);
    expect(merged.status).toBe('applied');
    const record = merged.record as Expense;
    expect(record.note).toBe('hello');
    expect(record.amountMinor).toBe(1234);
    expect(record.date).toBe('2026-10-06');
    expect(record.categoryId).toBe(category);

    // 3. A new category with no name.
    const categoryId = uuidv7();
    const noName = await pushOk(user, [
      pushItem({ entity: 'category', id: categoryId, fields: { color: '#2F8044' } }),
    ]);
    expect(resultFor(noName, categoryId).status).toBe('invalid');

    /**
     * 4. `fields: {}`.
     *
     * The plan's step 4 expected `400 validation_error` **for the whole request**, and
     * that expectation is wrong — corrected in the plan on 2026-10-22 rather than filed
     * as a defect, because the published contract says the opposite in as many words.
     * `docs/api/openapi.yaml` on `POST /v1/sync`: "**Each item is validated on its
     * own**, not as part of the body … a malformed item is a per-record `invalid`, not a
     * `400` that takes the whole batch with it. The exception is an item missing
     * `entity`, `id` or `clientMutationId`". `routes/sync.ts` and `sync/batch.ts` carry
     * the same reasoning, and it is the same reasoning `SYNC-28` asserts: a `400` here
     * would wedge an offline outbox behind one permanently-unacceptable row.
     *
     * Asserted as the contract actually specifies it, so the case defends the real rule.
     */
    const emptyFields = await push(user, [
      {
        entity: 'expense',
        id: existing.id,
        updatedAt: new Date().toISOString(),
        clientMutationId: uuidv7(),
        fields: {},
      },
    ]);
    expect(emptyFields.status).toBe(200);
    const emptyResult = resultFor(emptyFields.body.results, existing.id);
    expect(emptyResult.status).toBe('invalid');
    expect(emptyResult.error?.code).toBe('validation_error');
    expect(emptyResult.error?.message).toMatch(/validation/i);

    // The row it names is untouched: the note from step 2 is still there.
    const after = await pull(user, { since: 0 });
    expect((changeFor(after.changes, existing.id)?.record as Expense).note).toBe('hello');

    /**
     * The one item-level failure that *is* a `400`, per the same contract paragraph: an
     * item with no `clientMutationId` cannot be answered per-record, because a result
     * has nothing to be keyed on.
     */
    const unaddressable = await push(user, [
      { entity: 'expense', id: existing.id, updatedAt: new Date().toISOString(), fields: {} },
    ]);
    expect(unaddressable.status).toBe(400);
    expect(unaddressable.error?.code).toBe('validation_error');
  });
});

describe('SYNC-31 — undelete by setting deletedAt back to null', () => {
  it('revives the row, is blocked by a dead category, and never blocks a delete', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;

    // A tombstoned expense, deleted through the REST path.
    const expense = await createExpense(user, { categoryId: category, amountMinor: 450 });
    const deleted = await api()
      .delete(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth);
    expect(deleted.status).toBe(200);

    const newer = () => new Date(Date.now() + 1000).toISOString();

    // The undelete. `POST /v1/sync` is the only path that can do this: the REST PATCH
    // declares no `deletedAt`, so a tombstone is a 404 there (`EXP-06`).
    const revived = resultFor(
      await pushOk(user, [
        pushItem({
          entity: 'expense',
          id: expense.id,
          updatedAt: newer(),
          fields: { deletedAt: null },
        }),
      ]),
      expense.id,
    );
    expect(revived.status).toBe('applied');
    expect((revived.record as Expense).deletedAt).toBeNull();

    // It is live again on the REST surface, which is what makes `EXP-14` safe.
    const listed = await api()
      .get('/v1/expenses?from=2026-10-01&to=2026-10-31')
      .set('Authorization', user.auth);
    expect(listed.status).toBe(200);
    expect((listed.body.data as Expense[]).map((e) => e.id)).toContain(expense.id);

    // Now kill the expense *and* its category, and try the same undelete.
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);
    const ownCategory = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Doomed', color: '#2F8044' });
    expect(ownCategory.status).toBe(201);
    const doomedCategory = ownCategory.body.data.id as string;

    const repointed = resultFor(
      await pushOk(user, [
        pushItem({
          entity: 'expense',
          id: expense.id,
          updatedAt: newer(),
          fields: { categoryId: doomedCategory, deletedAt: new Date().toISOString() },
        }),
      ]),
      expense.id,
    );
    expect(repointed.status).toBe('applied');

    await api().delete(`/v1/categories/${doomedCategory}`).set('Authorization', user.auth);

    // A row that ends up **live** must point at a live category, and the server
    // re-checks even though `categoryId` is unchanged.
    const blocked = resultFor(
      await pushOk(user, [
        pushItem({
          entity: 'expense',
          id: expense.id,
          updatedAt: newer(),
          fields: { deletedAt: null },
        }),
      ]),
      expense.id,
    );
    expect(blocked.status).toBe('invalid');
    expect(blocked.error?.code).toBe('unknown_category');

    // Tombstoning is never blocked by a category the user already cleaned up — the
    // asymmetry `requireLive: deletedAt === null` encodes.
    const tombstoned = resultFor(
      await pushOk(user, [
        pushItem({
          entity: 'expense',
          id: expense.id,
          updatedAt: newer(),
          fields: { deletedAt: new Date().toISOString() },
        }),
      ]),
      expense.id,
    );
    expect(tombstoned.status).toBe('applied');

    // Repointing at a live category in the same push is `applied`.
    const okAgain = resultFor(
      await pushOk(user, [
        pushItem({
          entity: 'expense',
          id: expense.id,
          updatedAt: newer(),
          fields: { categoryId: user.defaultCategory.id, deletedAt: null },
        }),
      ]),
      expense.id,
    );
    expect(okAgain.status).toBe('applied');
    expect((okAgain.record as Expense).deletedAt).toBeNull();
  });
});

describe('SYNC-38 — pull paging terminates and delivers every row exactly once', () => {
  it('pages 1200 rows with no overlap, no gap, and a storable final cursor', async () => {
    const user = await createUser();
    const category = user.defaultCategory.id;
    const TOTAL = 1200;

    // Created through pushes rather than 1200 REST calls: three round trips instead of
    // 1200, and the rows are identical either way.
    const created: string[] = [];
    for (let sent = 0; sent < TOTAL; sent += LIMITS.SYNC_MAX_BATCH_SIZE) {
      const size = Math.min(LIMITS.SYNC_MAX_BATCH_SIZE, TOTAL - sent);
      const items = Array.from({ length: size }, (_, i) =>
        expenseItem(category, { amountMinor: 100 + ((sent + i) % 900) }),
      );
      const results = await pushOk(user, items);
      expect(results.every((r) => r.status === 'applied')).toBe(true);
      created.push(...items.map((item) => item.id));
    }
    expect(new Set(created).size).toBe(TOTAL);

    const { changes, pages, cursor } = await pullAll(user, { limit: 500 });

    // More than one page was genuinely involved, or "exactly once" is unfalsifiable.
    expect(pages).toBeGreaterThan(1);

    // Ordered by revision ascending across the whole sequence, with no overlap.
    const revisions = changes.map((c) => c.record.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);

    // Every created id exactly once. The six seeded categories are also in the stream,
    // so the expense ids are counted rather than the total length.
    const seen = changes.filter((c) => c.entity === 'expense').map((c) => c.record.id);
    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    for (const id of created) expect(seen).toContain(id);

    // An up-to-date client can store the final cursor unconditionally.
    const afterEnd = await pull(user, { since: cursor, limit: 500 });
    expect(afterEnd.changes).toEqual([]);
    expect(afterEnd.hasMore).toBe(false);
    expect(afterEnd.nextCursor).toBe(cursor);
    expect(afterEnd.resyncRequired).toBe(false);
  });
});
