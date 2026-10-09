import { ExpenseResponse, LIMITS } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { createExpense, createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { changeFor, pull, push, pushOk, resultFor } from './support/sync.ts';

/**
 * The API-layer steps of the named edge cases in `docs/qa/TEST_PLAN.md` §9 —
 * `EDGE-01` (an amount of 0), `EDGE-02` (very large amounts) and `EDGE-04` (a date in
 * the future).
 *
 * These exist because the suite already covers the *reject* side of both boundaries
 * (`expenses.test.ts` sends `-1`, `1_000_000_000_000`, `12.34` and `"1234"`) and nothing
 * covers the *accept* side. A boundary tested only from outside is the classic off-by-one
 * blind spot: `AmountMinor.max(AMOUNT_MINOR_MAX - 1)`, or an `int4` column where the
 * contract promises twelve digits, would leave every existing test green.
 *
 * Three properties here are specific to this layer and unreachable from a schema test:
 *
 *  * `0` is **falsy**. A write path spelled `if (fields.amountMinor)` instead of
 *    `=== undefined` drops a correction to zero and leaves the old amount standing, and
 *    a mapper spelled `row.amountMinor || null` reports it as absent.
 *  * `amount_minor` is `bigint` in Postgres and an integer on the wire. The narrowing
 *    lives in one mapper; removing it fails `sendJson`'s outgoing schema check, and
 *    anything that got past that would hand `JSON.stringify` a `BigInt`, which throws.
 *    Either way a 500 rather than a wrong number — so these cases are about the value
 *    being exact, and the ones below that assert `typeof === 'number'` are about it not
 *    arriving as a string.
 *  * the contract's `date` has **no upper bound** while the client's picker does, and
 *    that asymmetry is deliberate (`EDGE-04`). A server that rejected a future date
 *    would break a peer device whose clock runs ahead.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

/** A client edit time in the recent past, so the `now + 5min` clamp cannot rewrite it. */
const editedAt = (): string => new Date(Date.now() - 60_000).toISOString();

describe('EDGE-01 — an amount of 0', () => {
  it('accepts 0 on the REST create path and reports it as the number 0', async () => {
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: 0,
      date: '2026-10-06',
    });

    expect(response.status).toBe(201);
    expect(() => ExpenseResponse.parse(response.body)).not.toThrow();
    // `toBe(0)`, not `toBeFalsy()`: `null` and `undefined` would both pass the latter,
    // and reporting a zero amount as absent is the bug this case exists for.
    expect(response.body.data.amountMinor).toBe(0);
    expect(typeof response.body.data.amountMinor).toBe('number');

    const list = await api()
      .get('/v1/expenses')
      .set('Authorization', user.auth)
      .query({ from: '2026-10-06', to: '2026-10-06' });
    expect(list.status).toBe(200);
    expect(list.body.data[0].amountMinor).toBe(0);
  });

  it('applies a PATCH down to 0 rather than reading it as an absent field', async () => {
    const expense = await createExpense(user, {
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
    });

    const response = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ amountMinor: 0 });

    expect(response.status).toBe(200);
    expect(response.body.data.amountMinor).toBe(0);
    // A dropped patch field is still a write, so "did it apply" cannot be answered by the
    // status alone: the revision has to have moved too.
    expect(response.body.data.revision).toBeGreaterThan(expense.revision);
  });

  it('accepts 0 through the sync push path, on a create and on an update', async () => {
    const id = uuidv7();
    const [created] = await pushOk(user, [
      {
        entity: 'expense',
        id,
        updatedAt: editedAt(),
        clientMutationId: uuidv7(),
        fields: { categoryId: user.categories.Groceries!.id, amountMinor: 0, date: '2026-10-06' },
      },
    ]);

    expect(created?.status).toBe('applied');
    expect(created?.record).toMatchObject({ id, amountMinor: 0 });

    // The merge path is the other half: `amountMinor: 0` must not merge as "unset".
    const [updated] = await pushOk(user, [
      {
        entity: 'expense',
        id,
        updatedAt: new Date(Date.now() - 30_000).toISOString(),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 0 },
      },
    ]);
    expect(updated?.status).toBe('applied');
    expect(updated?.record).toMatchObject({ amountMinor: 0 });
  });
});

describe('EDGE-02 — very large amounts', () => {
  const MAX = LIMITS.AMOUNT_MINOR_MAX;

  it('round-trips the largest accepted amount exactly, through create, read and list', async () => {
    const created = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: MAX,
      date: '2026-10-06',
    });

    expect(created.status).toBe(201);
    expect(() => ExpenseResponse.parse(created.body)).not.toThrow();
    expect(created.body.data.amountMinor).toBe(MAX);
    // The `bigint` column is narrowed in one mapper. A path that misses it serialises a
    // `BigInt` — a 500 — or a string, and `999999999999 === "999999999999"` is false, so
    // the type assertion is doing work the value assertion cannot.
    expect(typeof created.body.data.amountMinor).toBe('number');
    expect(Number.isSafeInteger(created.body.data.amountMinor)).toBe(true);

    // Read back through the list, which is the only GET for an expense — the contract has
    // no `GET /v1/expenses/{id}`, only PATCH and DELETE. A second response builder is the
    // point: the create response and the list page narrow the column separately.
    const list = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(list.status).toBe(200);
    expect(list.body.data[0].amountMinor).toBe(MAX);
    expect(typeof list.body.data[0].amountMinor).toBe('number');

    // And up to the maximum through a PATCH, which builds its response from the updated
    // row rather than from the created one.
    const small = await createExpense(user, {
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
    });
    const patched = await api()
      .patch(`/v1/expenses/${small.id}`)
      .set('Authorization', user.auth)
      .send({ amountMinor: MAX });
    expect(patched.status).toBe(200);
    expect(patched.body.data.amountMinor).toBe(MAX);
  });

  it('round-trips the largest accepted amount through a push and back out on a pull', async () => {
    const id = uuidv7();
    const since = await revisionWatermark(user.user.id);

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id,
        updatedAt: editedAt(),
        clientMutationId: uuidv7(),
        fields: { categoryId: user.categories.Groceries!.id, amountMinor: MAX, date: '2026-10-06' },
      },
    ]);
    expect(result?.status).toBe('applied');
    expect(result?.record).toMatchObject({ amountMinor: MAX });

    // The pull is a different response builder from the push result, so it is a separate
    // chance to hand back a BigInt.
    const page = await pull(user, { since });
    const change = changeFor(page.changes, id);
    expect(change?.record).toMatchObject({ amountMinor: MAX });
    expect(typeof (change?.record as { amountMinor: unknown }).amountMinor).toBe('number');
  });

  it('reports an oversized amount on the push path as a per-record invalid, not a 400', async () => {
    const good = uuidv7();
    const bad = uuidv7();

    const outcome = await push(user, [
      {
        entity: 'expense',
        id: bad,
        updatedAt: editedAt(),
        clientMutationId: uuidv7(),
        fields: {
          categoryId: user.categories.Groceries!.id,
          amountMinor: MAX + 1,
          date: '2026-10-06',
        },
      },
      {
        entity: 'expense',
        id: good,
        updatedAt: editedAt(),
        clientMutationId: uuidv7(),
        fields: { categoryId: user.categories.Groceries!.id, amountMinor: 1234, date: '2026-10-06' },
      },
    ]);

    // Each item is validated on its own: one bad row is a per-record `invalid` inside a
    // 200, never a batch-level 400. Getting this backwards is what three cases in the
    // test plan originally asserted, and a tester running those would have filed a bug
    // against correct server behaviour.
    expect(outcome.status).toBe(200);
    expect(resultFor(outcome.body.results, bad).status).toBe('invalid');
    expect(resultFor(outcome.body.results, bad).error?.code).toBe('validation_error');
    // And the good row behind it is still applied.
    expect(resultFor(outcome.body.results, good).status).toBe('applied');
  });
});

describe('EDGE-04 — an expense dated in the future', () => {
  it('accepts a future date on the REST path and keeps the exact day', async () => {
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
      date: '2027-01-01',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.date).toBe('2027-01-01');
  });

  it('keeps the last calendar date the contract can express', async () => {
    // `YYYY-MM-DD` tops out at `9999-12-31`, and the mapper formats a `DATE` by slicing
    // `toISOString()`. A five-digit year would make that slice silently wrong, so this
    // pins the edge of the range rather than a date merely "far away".
    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
      date: '9999-12-31',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.date).toBe('9999-12-31');
  });

  it('delivers a future-dated expense pushed by a peer unchanged on a pull', async () => {
    const id = uuidv7();
    const since = await revisionWatermark(user.user.id);

    const [result] = await pushOk(user, [
      {
        entity: 'expense',
        id,
        updatedAt: editedAt(),
        clientMutationId: uuidv7(),
        fields: { categoryId: user.categories.Groceries!.id, amountMinor: 500, date: '2027-01-01' },
      },
    ]);
    expect(result?.status).toBe('applied');

    const page = await pull(user, { since });
    expect(changeFor(page.changes, id)?.record).toMatchObject({ date: '2027-01-01' });
  });

  it('still orders a future-dated row first in the list, rather than hiding it', async () => {
    // The list has no upper date bound either. If a future row were filtered out here the
    // app would never see it, which would close GAP 5 by accident and in the wrong place.
    await createExpense(user, { categoryId: user.categories.Groceries!.id, date: '2026-10-06' });
    await createExpense(user, { categoryId: user.categories.Groceries!.id, date: '2027-01-01' });

    const list = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((row: { date: string }) => row.date)).toEqual([
      '2027-01-01',
      '2026-10-06',
    ]);
  });
});
