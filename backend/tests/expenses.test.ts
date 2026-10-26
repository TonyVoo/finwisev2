import { ExpenseResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { clientId, createExpense, createUser, revisionWatermark } from './support/fixtures.ts';

/**
 * `/v1/expenses` write paths against the contract, following `docs/qa/TEST_PLAN.md` §5.
 *
 * The list endpoint has its own file; this one is create, update and delete.
 */

describe('POST /v1/expenses', () => {
  it('creates an expense with integer money and a zone-less date', async () => {
    const user = await createUser();

    const response = await api().post('/v1/expenses').set('Authorization', user.auth).send({
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
      currency: 'USD',
      date: '2026-10-06',
      note: 'Weekly shop',
    });

    expect(response.status).toBe(201);
    expect(() => ExpenseResponse.parse(response.body)).not.toThrow();
    // The integer 1234, not 12.34 and not "1234": money never round-trips as a float.
    expect(response.body.data.amountMinor).toBe(1234);
    expect(typeof response.body.data.amountMinor).toBe('number');
    // Exactly the day sent. A timestamp column would shift this for half the world.
    expect(response.body.data.date).toBe('2026-10-06');
    expect(response.body.data.note).toBe('Weekly shop');
    expect(response.body.data.deletedAt).toBeNull();
    expect(response.body.data.revision).toBeGreaterThan(0);
    expect(response.body.data.createdAt).toBe(response.body.data.updatedAt);
  });

  it('keeps a client-minted id, and is idempotent on a re-post of it', async () => {
    const user = await createUser();
    const id = clientId();
    const base = { categoryId: user.categories.Groceries!.id, date: '2026-10-06' };

    const first = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({ id, ...base, amountMinor: 1234 });
    const watermark = await revisionWatermark(user.user.id);
    const second = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      // A different amount: a replay is not an upsert, so it is ignored. `PATCH` is how
      // a field changes, and `POST /v1/sync` is where upsert semantics live.
      .send({ id, ...base, amountMinor: 9999 });

    expect(first.status).toBe(201);
    expect(first.body.data.id).toBe(id);
    expect(second.status).toBe(201);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.data.amountMinor).toBe(1234);
    expect(await revisionWatermark(user.user.id)).toBe(watermark);

    const list = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(list.body.data).toHaveLength(1);
  });

  it('refuses an id that belongs to another account', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);
    const target = await createExpense(theirs, { categoryId: theirs.categories.Groceries!.id });

    const response = await api().post('/v1/expenses').set('Authorization', mine.auth).send({
      id: target.id,
      categoryId: mine.categories.Groceries!.id,
      amountMinor: 1,
      date: '2026-10-06',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');

    // Theirs is untouched: no write, and nothing of theirs in the response.
    const theirList = await api().get('/v1/expenses').set('Authorization', theirs.auth);
    expect(theirList.body.data).toEqual([target]);
  });

  it('defaults currency to the account’s and refuses any other', async () => {
    const user = await createUser();
    const base = {
      categoryId: user.categories.Groceries!.id,
      amountMinor: 500,
      date: '2026-10-06',
    };

    const omitted = await api().post('/v1/expenses').set('Authorization', user.auth).send(base);
    const foreign = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({ ...base, currency: 'EUR' });
    const lowercase = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({ ...base, currency: 'usd' });

    expect(omitted.status).toBe(201);
    expect(omitted.body.data.currency).toBe('USD');

    // There is no conversion in the MVP, so a second currency would silently corrupt
    // every total that sums `amountMinor`.
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('validation_error');

    // ISO 4217 codes are uppercase; the schema rejects the case before the handler runs.
    expect(lowercase.status).toBe(400);
    expect(lowercase.body.error.code).toBe('validation_error');
  });

  it('honours a non-USD account currency', async () => {
    const user = await createUser({ currency: 'JPY' });

    const response = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({ categoryId: user.categories.Groceries!.id, amountMinor: 125, date: '2026-10-06' });

    expect(response.status).toBe(201);
    expect(response.body.data.currency).toBe('JPY');
    // A zero-decimal currency: 125 is ¥125, not ¥1.25. The server stores minor units
    // whatever the exponent, and never divides by 100.
    expect(response.body.data.amountMinor).toBe(125);
  });

  it('rejects an unknown, foreign or tombstoned category as unknown_category', async () => {
    const [user, other] = await Promise.all([createUser(), createUser()]);
    const base = { amountMinor: 500, date: '2026-10-06' };

    const deletedCategory = user.categories.Health!.id;
    await api().delete(`/v1/categories/${deletedCategory}`).set('Authorization', user.auth);

    const cases: Record<string, string> = {
      'no such category': clientId(),
      'another account’s category': other.categories.Groceries!.id,
      'a tombstoned category': deletedCategory,
    };

    for (const [label, categoryId] of Object.entries(cases)) {
      const response = await api()
        .post('/v1/expenses')
        .set('Authorization', user.auth)
        .send({ ...base, categoryId });

      // All three are the same answer: "live category of this account" is the rule, and
      // reporting the foreign one differently would make the field a probe.
      expect(response.status, label).toBe(422);
      expect(response.body.error.code, label).toBe('unknown_category');
    }
  });

  it('rejects a non-integer amount, an out-of-range amount and a bad date', async () => {
    const user = await createUser();
    const base = { categoryId: user.categories.Groceries!.id, date: '2026-10-06' };

    const cases: Record<string, object> = {
      'a fractional amount': { ...base, amountMinor: 12.34 },
      'a stringified amount': { ...base, amountMinor: '1234' },
      'a negative amount': { ...base, amountMinor: -1 },
      'an oversized amount': { ...base, amountMinor: 1_000_000_000_000 },
      'a non-date': { ...base, amountMinor: 1, date: '06/10/2026' },
      'a timestamp where a calendar date belongs': {
        ...base,
        amountMinor: 1,
        date: '2026-10-06T00:00:00Z',
      },
      'an impossible calendar date': { ...base, amountMinor: 1, date: '2026-02-30' },
      'an unknown field': { ...base, amountMinor: 1, nope: 1 },
      'a client-set revision': { ...base, amountMinor: 1, revision: 5 },
      'an over-long note': { ...base, amountMinor: 1, note: 'x'.repeat(501) },
    };

    for (const [label, body] of Object.entries(cases)) {
      const response = await api().post('/v1/expenses').set('Authorization', user.auth).send(body);
      expect(response.status, label).toBe(400);
      expect(response.body.error.code, label).toBe('validation_error');
      expect(response.body.error.details?.issues?.length, label).toBeGreaterThan(0);
    }
  });
});

describe('PATCH /v1/expenses/:id', () => {
  it('applies only the fields sent, and clears a note on null', async () => {
    const user = await createUser();
    const expense = await createExpense(user, {
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
      note: 'Weekly shop',
    });

    const amount = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ amountMinor: 1499 });

    expect(amount.status).toBe(200);
    expect(amount.body.data.amountMinor).toBe(1499);
    expect(amount.body.data.note).toBe('Weekly shop');
    expect(amount.body.data.date).toBe(expense.date);
    expect(amount.body.data.categoryId).toBe(expense.categoryId);
    expect(amount.body.data.revision).toBeGreaterThan(expense.revision);
    expect(amount.body.data.updatedAt).not.toBe(expense.updatedAt);
    // `createdAt` is server-owned and immutable; only `updatedAt` moves.
    expect(amount.body.data.createdAt).toBe(expense.createdAt);

    const cleared = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ note: null });

    // `null` clears; `undefined` (absent) leaves it. Collapsing the two would make
    // clearing a note impossible.
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.note).toBeNull();
  });

  it('clears a note sent as whitespace, which has the same meaning as null', async () => {
    const user = await createUser();
    const expense = await createExpense(user, {
      categoryId: user.categories.Groceries!.id,
      note: 'Weekly shop',
    });

    const response = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ note: '   ' });

    // `TVO-39`. `ExpenseNoteInput` collapses a note that trims to nothing to `null`, so
    // the patch means "clear it" rather than "store an empty string". The alternative is
    // a second representation of "no note" in the column, which every later reader has
    // to know about; `null` is the one they already know.
    expect(response.status).toBe(200);
    expect(response.body.data.note).toBeNull();
  });

  it('moves an expense to another live category', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    const response = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ categoryId: user.categories.Transport!.id });

    expect(response.status).toBe(200);
    expect(response.body.data.categoryId).toBe(user.categories.Transport!.id);
  });

  it('rejects a move to a category that is not a live one of this account', async () => {
    const [user, other] = await Promise.all([createUser(), createUser()]);
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    for (const categoryId of [clientId(), other.categories.Groceries!.id]) {
      const response = await api()
        .patch(`/v1/expenses/${expense.id}`)
        .set('Authorization', user.auth)
        .send({ categoryId });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('unknown_category');
    }
  });

  it('rejects an empty patch, an unknown field and a foreign currency', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    for (const body of [
      {},
      { nope: 1 },
      { id: clientId() },
      { createdAt: new Date().toISOString() },
    ]) {
      const response = await api()
        .patch(`/v1/expenses/${expense.id}`)
        .set('Authorization', user.auth)
        .send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }

    const currency = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ currency: 'EUR' });
    expect(currency.status).toBe(400);
    expect(currency.body.error.code).toBe('validation_error');
  });

  it('does not resurrect a tombstoned expense', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    const response = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ amountMinor: 99 });

    // The REST surface has no un-delete — `deletedAt` is not in any update schema — so a
    // tombstone reads as gone. A 200 here would tell the client the row was live again.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});

describe('DELETE /v1/expenses/:id', () => {
  it('soft-deletes, returns the tombstone and is idempotent', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    const first = await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    expect(first.status).toBe(200);
    expect(() => ExpenseResponse.parse(first.body)).not.toThrow();
    expect(first.body.data.deletedAt).not.toBeNull();
    expect(first.body.data.revision).toBeGreaterThan(expense.revision);

    const watermark = await revisionWatermark(user.user.id);
    const second = await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    // The same tombstone, and no new revision: a retried delete must not push the row
    // onto another sync page.
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(await revisionWatermark(user.user.id)).toBe(watermark);
  });

  it('hides the tombstone from the list but keeps it under includeDeleted', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    const live = await api().get('/v1/expenses').set('Authorization', user.auth);
    const all = await api().get('/v1/expenses?includeDeleted=true').set('Authorization', user.auth);

    expect(live.body.data).toEqual([]);
    expect(all.body.data).toHaveLength(1);
    expect(all.body.data[0].deletedAt).not.toBeNull();
  });
});

describe('tenancy', () => {
  it('reports another account’s expense as not found on read, update and delete', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);
    const target = await createExpense(theirs, { categoryId: theirs.categories.Groceries!.id });

    const patched = await api()
      .patch(`/v1/expenses/${target.id}`)
      .set('Authorization', mine.auth)
      .send({ amountMinor: 1 });
    const deleted = await api().delete(`/v1/expenses/${target.id}`).set('Authorization', mine.auth);

    for (const response of [patched, deleted]) {
      // 404, never 403: indistinguishable from an id that does not exist.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('not_found');
    }

    const unknown = await api()
      .delete(`/v1/expenses/${clientId()}`)
      .set('Authorization', mine.auth);
    expect(unknown.status).toBe(patched.status);
    expect(unknown.body.error.code).toBe(patched.body.error.code);
    expect(unknown.body.error.message).toBe(patched.body.error.message);

    // Theirs is intact and unchanged.
    const theirList = await api().get('/v1/expenses').set('Authorization', theirs.auth);
    expect(theirList.body.data).toEqual([target]);
  });

  it('returns an empty page, not an error, for another account’s categoryId', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);
    await createExpense(mine, { categoryId: mine.categories.Groceries!.id });

    const response = await api()
      .get(`/v1/expenses?categoryId=${theirs.categories.Groceries!.id}`)
      .set('Authorization', mine.auth);

    // An unknown `categoryId` matches nothing rather than erroring, which is also what
    // makes a foreign id indistinguishable from a non-existent one here.
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});
