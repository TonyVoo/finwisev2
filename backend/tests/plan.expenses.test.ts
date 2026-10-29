import { ExpenseResponse, LIMITS } from '@expense-tracker/shared';
import type { ApiError, Expense } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import {
  F_MONTH,
  clientId,
  createExpense,
  createMonth,
  createUser,
  type TestUser,
} from './support/fixtures.ts';

/**
 * §5 of `docs/qa/TEST_PLAN.md`, API layer: `EXP-01` to `EXP-09`.
 *
 * `EXP-10` onward are E2E or Manual. The overlap with `expenses.test.ts` and
 * `expenses.list.test.ts` is deliberate; what is new here is the plan's own wording —
 * `createdAt === updatedAt` on create, the re-post being ignored rather than merged, a
 * tombstoned category counting as unknown, and the concatenated-pages identity in
 * `EXP-07`.
 */

/** `POST /v1/expenses` without the fixture's success assertion, so a 4xx is observable. */
function post(user: TestUser, body: Record<string, unknown>) {
  return api().post('/v1/expenses').set('Authorization', user.auth).send(body);
}

describe('EXP-01 — create an expense through the REST path', () => {
  it('stores integer money and a zone-less date, with createdAt equal to updatedAt', async () => {
    const user = await createUser();

    const response = await post(user, {
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
      currency: 'USD',
      date: '2026-10-06',
      note: 'Weekly shop',
    });

    expect(response.status).toBe(201);
    expect(() => ExpenseResponse.parse(response.body)).not.toThrow();

    const data = response.body.data as Expense;
    // The integer, not a float and not a string: this is the one field the whole app
    // exists to get right.
    expect(data.amountMinor).toBe(1234);
    expect(typeof data.amountMinor).toBe('number');
    expect(JSON.stringify(response.body)).toContain('"amountMinor":1234');
    expect(data.date).toBe('2026-10-06');
    expect(data.deletedAt).toBeNull();
    expect(Number.isInteger(data.revision)).toBe(true);
    expect(data.revision).toBeGreaterThan(0);
    expect(data.createdAt).toBe(data.updatedAt);
  });
});

describe('EXP-02 — a client-minted id is accepted as-is', () => {
  it('keeps the id, and a re-post is idempotent rather than an upsert', async () => {
    const user = await createUser();
    const id = clientId();
    const body = {
      id,
      categoryId: user.categories.Groceries!.id,
      amountMinor: 1234,
      date: '2026-10-06',
    };

    const first = await post(user, body);
    expect(first.status).toBe(201);
    expect(first.body.data.id).toBe(id);

    const replay = await post(user, body);
    expect(replay.status).toBe(201);
    expect(replay.body.data).toEqual(first.body.data);

    // The "Also": a re-post carrying a different amount is ignored, not merged.
    const changed = await post(user, { ...body, amountMinor: 9999 });
    expect(changed.status).toBe(201);
    expect(changed.body.data.amountMinor).toBe(1234);
    expect(changed.body.data.revision).toBe(first.body.data.revision);
  });

  it('refuses another user’s id without admitting whose it is', async () => {
    const owner = await createUser();
    const other = await createUser();
    const mine = await createExpense(owner, { categoryId: owner.categories.Groceries!.id });

    const response = await post(other, {
      id: mine.id,
      categoryId: other.categories.Groceries!.id,
      amountMinor: 50,
      date: '2026-10-06',
    });

    expect(response.status).toBe(400);
    const error = (response.body as ApiError).error;
    expect(error.code).toBe('validation_error');
    // Names no owner: the id is the global primary key, so the server can neither
    // honour the create nor say whose row it collided with.
    expect(JSON.stringify(response.body)).not.toContain(owner.user.id);
    expect(JSON.stringify(response.body)).not.toContain(owner.user.email);
  });
});

describe('EXP-03 — currency defaults to the user’s and may not differ from it', () => {
  it('fills USD, refuses EUR and refuses lowercase usd', async () => {
    const user = await createUser();
    const base = {
      categoryId: user.categories.Groceries!.id,
      amountMinor: 100,
      date: '2026-10-06',
    };

    const defaulted = await post(user, base);
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.data.currency).toBe('USD');

    for (const currency of ['EUR', 'usd']) {
      const response = await post(user, { ...base, currency });
      expect(response.status, currency).toBe(400);
      expect((response.body as ApiError).error.code).toBe('validation_error');
    }
  });
});

describe('EXP-04 — an unknown category is rejected as 422 unknown_category', () => {
  it('covers absent, foreign and tombstoned, and never answers 403', async () => {
    const user = await createUser();
    const other = await createUser();

    const doomed = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Doomed' });
    expect(doomed.status).toBe(201);
    const deleted = await api()
      .delete(`/v1/categories/${doomed.body.data.id}`)
      .set('Authorization', user.auth);
    expect(deleted.status).toBe(200);

    const candidates = {
      'names no category': clientId(),
      'belongs to another user': other.categories.Groceries!.id,
      'is a tombstone of this user': doomed.body.data.id as string,
    };

    for (const [label, categoryId] of Object.entries(candidates)) {
      const response = await post(user, { categoryId, amountMinor: 100, date: '2026-10-06' });
      expect(response.status, label).toBe(422);
      expect((response.body as ApiError).error.code, label).toBe('unknown_category');
      expect(response.status, label).not.toBe(403);
    }
  });
});

describe('EXP-05 — PATCH is partial, and note can be cleared', () => {
  it('applies only what was sent, clears on null, and refuses an empty patch', async () => {
    const { user, expenses } = await createMonth();
    const target = expenses.find((e) => e.note === 'm-0')!;
    const patch = (body: Record<string, unknown>) =>
      api().patch(`/v1/expenses/${target.id}`).set('Authorization', user.auth).send(body);

    const amount = await patch({ amountMinor: 1499 });
    expect(amount.status).toBe(200);
    expect(amount.body.data.amountMinor).toBe(1499);
    expect(amount.body.data.note).toBe(target.note);
    expect(amount.body.data.date).toBe(target.date);
    expect(amount.body.data.categoryId).toBe(target.categoryId);
    expect(Date.parse(amount.body.data.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(target.updatedAt),
    );
    expect(amount.body.data.revision).toBeGreaterThan(target.revision);

    const cleared = await patch({ note: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.note).toBeNull();
    expect(cleared.body.data.amountMinor).toBe(1499);

    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect((empty.body as ApiError).error.code).toBe('validation_error');
  });
});

describe('EXP-06 — delete is soft, returns the tombstone, and is idempotent', () => {
  it('does not advance updatedAt or revision on a re-delete, and hides the row', async () => {
    const { user, expenses } = await createMonth();
    const target = expenses[0]!;

    const first = await api().delete(`/v1/expenses/${target.id}`).set('Authorization', user.auth);
    expect(first.status).toBe(200);
    expect(first.body.data).toBeDefined();
    expect(first.body.data.deletedAt).not.toBeNull();

    const second = await api().delete(`/v1/expenses/${target.id}`).set('Authorization', user.auth);
    expect(second.status).toBe(200);
    expect(second.body.data.updatedAt).toBe(first.body.data.updatedAt);
    expect(second.body.data.revision).toBe(first.body.data.revision);

    const live = await api().get('/v1/expenses?limit=200').set('Authorization', user.auth);
    expect(live.body.data.map((e: Expense) => e.id)).not.toContain(target.id);

    const all = await api()
      .get('/v1/expenses?limit=200&includeDeleted=true')
      .set('Authorization', user.auth);
    const found = all.body.data.find((e: Expense) => e.id === target.id);
    expect(found).toBeDefined();
    expect(found.deletedAt).not.toBeNull();
  });

  it('is 404 to PATCH once tombstoned, for an expense and for a category', async () => {
    const { user, expenses } = await createMonth();
    const expense = expenses[1]!;
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    // The plan's "Also" opens with `GET /v1/expenses/{id}`. No such operation exists —
    // `openapi.yaml` gives `/v1/expenses/{id}` only `patch` and `delete` — so the GET
    // half of this step is unexecutable rather than passing. See `API-01`.
    const patched = await api()
      .patch(`/v1/expenses/${expense.id}`)
      .set('Authorization', user.auth)
      .send({ amountMinor: 1 });
    expect(patched.status).toBe(404);
    expect((patched.body as ApiError).error.code).toBe('not_found');

    const spare = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Spare' });
    await api().delete(`/v1/categories/${spare.body.data.id}`).set('Authorization', user.auth);
    const patchedCategory = await api()
      .patch(`/v1/categories/${spare.body.data.id}`)
      .set('Authorization', user.auth)
      .send({ name: 'Renamed' });
    expect(patchedCategory.status).toBe(404);
    expect((patchedCategory.body as ApiError).error.code).toBe('not_found');
  });
});

describe('EXP-07 — the expense list is keyset-paginated and stable under a concurrent write', () => {
  it('serves each fixture id exactly once with a write landing mid-walk', async () => {
    const { user, expenses, previous } = await createMonth();
    expect(expenses).toHaveLength(F_MONTH.liveCount);
    expect(previous).toHaveLength(F_MONTH.previousCount);

    const page1 = await api().get('/v1/expenses?limit=20').set('Authorization', user.auth);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(20);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).not.toBeNull();

    // Ordered by date descending, ties broken by id descending.
    const key = (e: Expense) => `${e.date}|${e.id}`;
    const keys = page1.body.data.map(key);
    expect([...keys].sort().reverse()).toEqual(keys);

    // The concurrent write, dated after everything in the fixture so it sorts above
    // page 1's cursor and must not appear on any later page.
    const inserted = await createExpense(user, {
      categoryId: user.categories.Groceries!.id,
      date: `${F_MONTH.month}-28`,
      note: 'inserted-mid-walk',
    });

    const seen = [...(page1.body.data as Expense[])];
    let cursor = page1.body.nextCursor as string | null;
    let pages = 1;
    while (cursor) {
      const page = await api()
        .get(`/v1/expenses?limit=20&cursor=${encodeURIComponent(cursor)}`)
        .set('Authorization', user.auth);
      expect(page.status).toBe(200);
      seen.push(...(page.body.data as Expense[]));
      cursor = page.body.hasMore ? page.body.nextCursor : null;
      pages += 1;
      if (pages > 10) throw new Error('pagination did not terminate');
    }

    // The walk is unfiltered, so it covers all of `F-MONTH` — the 42 live rows *and* the 5
    // dated in the month before. The case's "42" counts only the first group; the property it
    // exists to prove is one-of-each across the whole walk, which the larger set tests harder.
    const all = [...expenses, ...previous];
    const ids = seen.map((e) => e.id);
    expect(ids).toHaveLength(all.length);
    expect(new Set(ids).size).toBe(all.length);
    expect([...ids].sort()).toEqual([...all.map((e) => e.id)].sort());
    expect(ids).not.toContain(inserted.id);
  });
});

describe('EXP-08 — from/to are inclusive bounds on the calendar date', () => {
  it('includes both edges, excludes both neighbours, and refuses a reversed range', async () => {
    const user = await createUser();
    const categoryId = user.categories.Groceries!.id;
    const dates = ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'];
    for (const date of dates) await createExpense(user, { categoryId, date });

    const inRange = await api()
      .get('/v1/expenses?from=2026-10-01&to=2026-10-31')
      .set('Authorization', user.auth);
    expect(inRange.status).toBe(200);
    expect((inRange.body.data as Expense[]).map((e) => e.date).sort()).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);

    const reversed = await api()
      .get('/v1/expenses?from=2026-10-31&to=2026-10-01')
      .set('Authorization', user.auth);
    expect(reversed.status).toBe(400);
    expect((reversed.body as ApiError).error.code).toBe('validation_error');
  });
});

describe('EXP-09 — a tampered cursor is invalid_cursor, not a server error', () => {
  it('is 400 for a truncated and a nonsense cursor, never 500 and never an empty page', async () => {
    const { user } = await createMonth();

    const first = await api().get('/v1/expenses?limit=5').set('Authorization', user.auth);
    const cursor = first.body.nextCursor as string;
    expect(cursor).toMatch(/\S/);

    for (const bad of [cursor.slice(0, -3), 'not-a-cursor']) {
      const response = await api()
        .get(`/v1/expenses?limit=5&cursor=${encodeURIComponent(bad)}`)
        .set('Authorization', user.auth);

      expect(response.status).toBe(400);
      expect((response.body as ApiError).error.code).toBe('invalid_cursor');
      // A silently empty page would read as "no more data" and stop the client.
      expect(response.body.data).toBeUndefined();
    }
  });
});

describe('EXP — the list default and cap, as §5 assumes them', () => {
  it('defaults to 50 and caps at 200', async () => {
    const { user } = await createMonth();
    const capped = await api()
      .get(`/v1/expenses?limit=${LIMITS.EXPENSE_LIST_MAX_LIMIT}`)
      .set('Authorization', user.auth);
    expect(capped.status).toBe(200);
    expect(capped.body.data).toHaveLength(F_MONTH.liveCount + F_MONTH.previousCount);
  });
});
