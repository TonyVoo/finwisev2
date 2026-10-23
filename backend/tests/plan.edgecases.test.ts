import { LIMITS, UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import type { ApiError, Category, Expense } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/accessToken.ts';
import { TEST_PASSWORD, api, bearer, uniqueEmail } from './support/api.ts';
import { createExpense, createUser } from './support/fixtures.ts';

/**
 * §10 of `docs/qa/TEST_PLAN.md`, API layer, plus the two §4/§9 cases that are executable
 * without a device: `AUTH-17`, `EDGE-06`, `EDGE-07`, `EDGE-09`, `EDGE-10`, `API-09`.
 *
 * These six were on the plan's unexecuted list for no better reason than that nobody had
 * written them. Each is API-layer in whole or in part; the device legs of `EDGE-06`,
 * `EDGE-09` and `EDGE-10` (the snackbar, the character counter, the disabled `Create`)
 * are still device-only and still unexecuted, and each case below says which half it is.
 *
 * The behaviour here overlaps `categories.test.ts` and `expenses.edgecases.test.ts` in
 * places, deliberately: those suites were written against the endpoints, these against
 * the plan's Expect clauses, which name figures the endpoint suites do not - six
 * categories exactly, a count that does not drop across a category delete, three distinct
 * `401` codes.
 */

describe('AUTH-17 — signup seeds exactly six categories, exactly one of them default', () => {
  it('returns six rows with server ids and a single Uncategorized default', async () => {
    const email = uniqueEmail('seed');
    const signup = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });
    expect(signup.status).toBe(201);

    const list = await api()
      .get('/v1/categories')
      .set('Authorization', bearer(signup.body.accessToken));
    expect(list.status).toBe(200);

    const categories = list.body.data as Category[];

    // Six, never twelve. The twelve is what a client that also seeds would produce, and
    // `00-foundations.md` §7 rule 7 puts seeding on the server alone.
    expect(categories).toHaveLength(6);

    const defaults = categories.filter((c) => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe(UNCATEGORIZED_NAME);

    // Server-assigned ids, so the client reads them off a pull rather than minting them.
    for (const category of categories) {
      expect(category.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(category.deletedAt).toBeNull();
    }

    // No two share a name, compared the way the uniqueness rule compares them.
    const lowered = categories.map((c) => c.name.toLowerCase());
    expect(new Set(lowered).size).toBe(6);
  });

  it('seeds a second account its own six, with no ids in common', async () => {
    const [first, second] = await Promise.all([createUser(), createUser()]);

    const ids = (user: typeof first): string[] => Object.values(user.categories).map((c) => c.id);
    expect(ids(first)).toHaveLength(6);
    expect(ids(second)).toHaveLength(6);
    expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([]);
  });
});

describe('EDGE-06 — a category deleted while it has expenses', () => {
  /**
   * The API half. The plan's fixture is 23 live `Groceries` expenses across three months;
   * what it is really asserting is that the count and the money are conserved, so both
   * are measured before and after rather than recomputed from the expected answer.
   *
   * The snackbar copy (`Groceries deleted. 23 expenses moved to Uncategorized.`) and the
   * Summary slice moving into `Uncategorized` are the device half, and are not executed.
   */
  it('keeps all 23 expenses, reassigns them to the default, and changes no total', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries;
    if (groceries === undefined) throw new Error('F-FRESH expected a seeded Groceries');

    const created: Expense[] = [];
    for (let i = 0; i < 23; i += 1) {
      created.push(
        await createExpense(user, {
          categoryId: groceries.id,
          amountMinor: 100 + i,
          // Three months, as the case specifies: the delete must not be month-scoped.
          date: `2026-${['08', '09', '10'][i % 3]}-${String((i % 28) + 1).padStart(2, '0')}`,
        }),
      );
    }
    const spend = created.reduce((sum, e) => sum + e.amountMinor, 0);

    const before = await api()
      .get('/v1/expenses?limit=200')
      .set('Authorization', user.auth);
    const beforeRows = before.body.data as Expense[];
    const beforeTotal = beforeRows.reduce((sum, e) => sum + e.amountMinor, 0);

    const deleted = await api()
      .delete(`/v1/categories/${groceries.id}`)
      .set('Authorization', user.auth);
    expect(deleted.status).toBe(200);

    const after = await api().get('/v1/expenses?limit=200').set('Authorization', user.auth);
    const afterRows = after.body.data as Expense[];

    // A drop in either of these is a data-loss P1, not a display bug - which is why the
    // count and the sum are both asserted rather than just "the rows are still there".
    expect(afterRows).toHaveLength(beforeRows.length);
    expect(afterRows.reduce((sum, e) => sum + e.amountMinor, 0)).toBe(beforeTotal);

    // Every one of the 23 now points at the default, and none of them is a tombstone.
    const byId = new Map(afterRows.map((e) => [e.id, e]));
    for (const original of created) {
      const now = byId.get(original.id);
      expect(now, `expense ${original.id} did not survive the category delete`).toBeDefined();
      expect(now?.categoryId).toBe(user.defaultCategory.id);
      expect(now?.deletedAt).toBeNull();
      expect(now?.amountMinor).toBe(original.amountMinor);
    }

    // And the money landed on the default rather than evaporating.
    const onDefault = afterRows
      .filter((e) => e.categoryId === user.defaultCategory.id)
      .reduce((sum, e) => sum + e.amountMinor, 0);
    expect(onDefault).toBeGreaterThanOrEqual(spend);
  });

  it('refuses to delete the default itself, because it is the reassignment target', async () => {
    const user = await createUser();

    const response = await api()
      .delete(`/v1/categories/${user.defaultCategory.id}`)
      .set('Authorization', user.auth);

    // Deleting it would leave a later delete with nowhere to move expenses to, which is
    // the data-loss branch the case above is guarding.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});

describe('EDGE-07 — an expired access token mid-action', () => {
  /**
   * The API half; the transparent-refresh half is `AUTH-10`, in `mobile/`.
   *
   * The three codes are distinct because the client's reaction to each differs: refresh
   * and retry, clear credentials and re-login, or treat the request as unauthenticated.
   * One code for all three is a fail even with the right status, so each is asserted by
   * name rather than by `toBe(401)` four times.
   */
  it('separates token_expired, token_invalid and unauthorized', async () => {
    const user = await createUser();

    // Signed by the server itself with a negative TTL: well-formed and genuinely expired,
    // rather than merely unparseable, which is what makes it a different code.
    const expired = await signAccessToken(user.user.id, -60);
    const a = await api().get('/v1/me').set('Authorization', bearer(expired.token));
    expect(a.status).toBe(401);
    expect((a.body as ApiError).error.code).toBe('token_expired');

    const tampered = `${user.accessToken.slice(0, -4)}${
      user.accessToken.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa'
    }`;
    const b = await api().get('/v1/me').set('Authorization', bearer(tampered));
    expect(b.status).toBe(401);
    expect((b.body as ApiError).error.code).toBe('token_invalid');

    const c = await api().get('/v1/me');
    expect(c.status).toBe(401);
    expect((c.body as ApiError).error.code).toBe('unauthorized');

    const d = await api().get('/v1/me').set('Authorization', 'Basic abc');
    expect(d.status).toBe(401);
    expect((d.body as ApiError).error.code).toBe('unauthorized');
  });
});

describe('EDGE-09 — a note at and past its limit, and whitespace-only', () => {
  /**
   * The API half. The character counter reading `500/500`, turning `warning.default` above
   * 450 and dropping the 501st keystroke is the device half, and is not executed.
   */
  it('accepts 500, rejects 501, and trims before measuring', async () => {
    const user = await createUser();
    const max = LIMITS.EXPENSE_NOTE_MAX;

    const atLimit = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({
        categoryId: user.defaultCategory.id,
        amountMinor: 100,
        date: '2026-10-06',
        note: 'n'.repeat(max),
      });
    expect(atLimit.status).toBe(201);
    expect((atLimit.body.data as Expense).note).toHaveLength(max);

    const past = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({
        categoryId: user.defaultCategory.id,
        amountMinor: 100,
        date: '2026-10-06',
        note: 'n'.repeat(max + 1),
      });
    expect(past.status).toBe(400);
    expect((past.body as ApiError).error.code).toBe('validation_error');

    // `ExpenseNote` trims, so the limit is measured after trimming: 500 characters inside
    // whitespace is 500, not 504.
    const padded = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({
        categoryId: user.defaultCategory.id,
        amountMinor: 100,
        date: '2026-10-06',
        note: `  ${'n'.repeat(max)}  `,
      });
    expect(padded.status).toBe(201);
    expect((padded.body.data as Expense).note).toBe('n'.repeat(max));
  });

  /**
   * `TVO-39`. The plan's Expect for the whitespace-only note is `note: null`, not `""`,
   * and the server stores `""`: `ExpenseNote` is `.trim().max(500)` with no `.min(1)`, and
   * `expenseService.ts:133` writes `input.note ?? null`, which leaves an empty string
   * alone. Nobody sees it today because the client normalises in `normaliseNote` and
   * `ExpenseRow` guards an empty note a second time - so this is a server that accepts a
   * row only its own client's manners keep out of the database.
   */
  it.fails('stores a whitespace-only note as null rather than an empty string', async () => {
    const user = await createUser();

    const response = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({
        categoryId: user.defaultCategory.id,
        amountMinor: 100,
        date: '2026-10-06',
        note: '   ',
      });

    expect(response.status).toBe(201);
    expect((response.body.data as Expense).note).toBeNull();
  });
});

describe('EDGE-10 — a category name at its bounds', () => {
  /**
   * The API half. The disabled `Create` with the helper `Enter a name.`, and the field
   * hard-capping at 64 via `maxLength`, are the device half and are not executed.
   */
  it('trims, refuses blank, and is inclusive at the 64-character bound', async () => {
    const user = await createUser();
    const max = LIMITS.CATEGORY_NAME_MAX;

    const padded = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: '  A  ' });
    expect(padded.status).toBe(201);
    expect((padded.body.data as Category).name).toBe('A');

    const blank = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: '   ' });
    expect(blank.status).toBe(400);
    expect((blank.body as ApiError).error.code).toBe('validation_error');

    const past = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'c'.repeat(max + 1) });
    expect(past.status).toBe(400);
    expect((past.body as ApiError).error.code).toBe('validation_error');

    const atLimit = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'c'.repeat(max) });
    expect(atLimit.status).toBe(201);
    expect((atLimit.body.data as Category).name).toHaveLength(max);
  });
});

describe('API-09 — rate limiting', () => {
  /**
   * `GAP 10` was filed as "the threshold is not quantified, so there is no number to
   * assert against". Executing the case says something sharper than that: there is no
   * limiter at all.
   *
   * `docs/api/openapi.yaml` says login is "rate limited per email and per source address"
   * and `shared/src/errors.ts` reserves `rate_limited` -> 429 for it. `rate_limited`
   * appears nowhere in `backend/src`, and the burst below confirms it from outside: every
   * attempt is answered, none is throttled. `TVO-38`.
   *
   * Written as two cases on purpose. The first records today's behaviour so this suite is
   * green and the finding lives in the board rather than in a permanently red file; the
   * second is the assertion the case actually wants, and it is the one to flip when the
   * limiter lands.
   */
  const BURST = 25;

  it('does not throttle a burst of failed logins for one email, which is the defect', async () => {
    const email = uniqueEmail('ratelimit');
    const signup = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });
    expect(signup.status).toBe(201);

    const statuses: number[] = [];
    for (let i = 0; i < BURST; i += 1) {
      const response = await api()
        .post('/v1/auth/login')
        .send({ email, password: 'definitely-not-the-password' });
      statuses.push(response.status);
    }

    // Every one of them got a real answer. An attacker's guess rate is bounded by nothing
    // but the argon2 verify, which is the whole of the protection that exists today.
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  }, 120_000);

  it.fails('eventually answers 429 with a Retry-After a client can obey', async () => {
    const email = uniqueEmail('ratelimit-wanted');
    await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    let limited: { status: number; body: unknown; retryAfter?: string } | null = null;
    for (let i = 0; i < BURST && limited === null; i += 1) {
      const response = await api()
        .post('/v1/auth/login')
        .send({ email, password: 'definitely-not-the-password' });
      if (response.status === 429) {
        limited = {
          status: response.status,
          body: response.body,
          retryAfter: response.headers['retry-after'],
        };
      }
    }

    expect(limited).not.toBeNull();
    expect((limited?.body as ApiError).error.code).toBe('rate_limited');

    // A `Retry-After` the client cannot parse is the same as none: the mobile client backs
    // off by this number, so it has to be a non-negative integer of seconds.
    const retryAfter = Number(limited?.retryAfter);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
