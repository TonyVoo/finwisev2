import {
  API_ROUTES,
  ApiError,
  ERROR_CODE_STATUS,
  ERROR_CODES,
  LIMITS,
  SERVER_OWNED_FIELDS,
  type ErrorCode,
} from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { TEST_PASSWORD, api, uniqueEmail } from './support/api.ts';
import { createExpense, createUser } from './support/fixtures.ts';
import { push, pushItem } from './support/sync.ts';

/**
 * §10 of `docs/qa/TEST_PLAN.md`, executed.
 *
 * These are the plan's own cross-cutting cases, asserted as the plan words them rather
 * than as the implementing suites happen to cover them. The overlap with
 * `tenancy.test.ts`, `categories.test.ts` and the rest is deliberate and is the point:
 * a dev suite that covers four fifths of a case has not executed it, and the fifth is
 * where `API-02`'s sync half and `API-05`'s envelope sweep live. Each `describe` names
 * its case id so a bug report's first `grep` lands on the assertion.
 */

/** Every response, 2xx included, carries `X-Request-Id` (`API-05`). */
function expectRequestId(response: { headers: Record<string, string | undefined> }): void {
  expect(response.headers['x-request-id']).toMatch(/\S/);
}

/**
 * Whether a `validation_error`'s issues identify a key, by whatever means.
 *
 * Deliberately checks `message` as well as `path`: measured on 2026-10-19, an
 * `unrecognized_keys` failure arrives as `{ path: "", message: 'Unrecognized key: "x"' }`
 * because `validate.ts` maps zod's issue path — empty for that code — and drops zod's
 * own `keys` array. `openapi.yaml` describes `path` as "dotted path to the offending
 * field", and the contract says never to parse `message`, so a client cannot currently
 * identify the field programmatically. Filed as its own task; asserted here as it
 * behaves so this suite reports that one defect rather than nine.
 */
function namesKey(issues: ReadonlyArray<{ path: string; message: string }>, key: string): boolean {
  return issues.some((issue) => issue.path.includes(key) || issue.message.includes(key));
}

/**
 * Assert a non-2xx body is the envelope and nothing else.
 *
 * `ApiError` is a `strictObject` over a `strictObject`, so parsing it is what rejects a
 * stray top-level key — the half of `API-05` a `toMatchObject` would pass.
 */
function expectEnvelope(
  response: { status: number; body: unknown; headers: Record<string, string | undefined> },
  code: ErrorCode,
): void {
  expect(() => ApiError.parse(response.body)).not.toThrow();
  const body = response.body as ApiError;
  expect(body.error.code).toBe(code);
  expect(response.status).toBe(ERROR_CODE_STATUS[code]);
  expectRequestId(response);
}

describe('API-01 — tenancy: another user’s row is 404, never 403', () => {
  it('answers not_found on every verb and an empty page on the filtered list', async () => {
    const a = await createUser();
    const b = await createUser();
    const expenseB = await createExpense(b, { categoryId: b.categories.Groceries!.id });
    const categoryB = b.categories.Transport!;

    // The plan's step list opens with `GET /v1/expenses/E_B`. There is no such
    // operation: `openapi.yaml` gives `/v1/expenses/{id}` only `patch` and `delete`, and
    // `API_ROUTES` agrees. A GET there is 404 for its owner too, so asserting it would
    // have been a case that cannot fail. Recorded against the case rather than dropped
    // silently; the mutations below are the tenancy assertion.
    expect(
      API_ROUTES.some(
        (route) => route.method === 'get' && (route.path as string) === '/v1/expenses/{id}',
      ),
    ).toBe(false);

    const attempts = [
      api().patch(`/v1/expenses/${expenseB.id}`).set('Authorization', a.auth).send({ note: 'x' }),
      api().delete(`/v1/expenses/${expenseB.id}`).set('Authorization', a.auth),
      api().patch(`/v1/categories/${categoryB.id}`).set('Authorization', a.auth).send({ name: 'x' }),
      api().delete(`/v1/categories/${categoryB.id}`).set('Authorization', a.auth),
    ];

    for (const response of await Promise.all(attempts)) {
      expectEnvelope(response, 'not_found');
      // Stated separately from the status: a 403 here is the defect this case exists for,
      // and `ERROR_CODE_STATUS` would let a `forbidden` code through its own 403.
      expect(response.status).not.toBe(403);
    }

    // An unknown `categoryId` matches nothing rather than erroring.
    const list = await api()
      .get(`/v1/expenses?categoryId=${categoryB.id}`)
      .set('Authorization', a.auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);

    // User B's rows are untouched throughout.
    const stillThere = await api().get('/v1/expenses').set('Authorization', b.auth);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.data).toEqual([expenseB]);
    const categories = await api().get('/v1/categories').set('Authorization', b.auth);
    expect(categories.body.data).toHaveLength(6);
    expect(categories.body.data.find((c: { id: string }) => c.id === categoryB.id)).toEqual(
      categoryB,
    );
  });
});

describe('API-02 — no endpoint accepts a userId', () => {
  it('rejects it in all five shapes and writes nothing to the named user', async () => {
    const a = await createUser();
    const b = await createUser();

    const expenseA = await createExpense(a, { categoryId: a.categories.Groceries!.id });
    const beforeB = {
      expenses: (await api().get('/v1/expenses').set('Authorization', b.auth)).body,
      categories: (await api().get('/v1/categories').set('Authorization', b.auth)).body,
    };

    // The three REST bodies: 400 with the offending path in `details.issues`.
    const rest = [
      api()
        .post('/v1/auth/signup')
        .send({ email: uniqueEmail(), password: TEST_PASSWORD, userId: b.user.id }),
      api()
        .post('/v1/expenses')
        .set('Authorization', a.auth)
        .send({
          categoryId: a.categories.Groceries!.id,
          amountMinor: 500,
          date: '2026-10-06',
          userId: b.user.id,
        }),
      api()
        .patch(`/v1/categories/${a.categories.Transport!.id}`)
        .set('Authorization', a.auth)
        .send({ name: 'Commuting', userId: b.user.id }),
    ];

    for (const response of await Promise.all(rest)) {
      expectEnvelope(response, 'validation_error');
      const issues = (response.body as ApiError).error.details?.issues ?? [];
      expect(namesKey(issues, 'userId'), JSON.stringify(issues)).toBe(true);
    }

    // The two sync shapes: per-record `invalid` / `immutable_field` inside an HTTP 200.
    // `userId` is in SERVER_OWNED_FIELDS, so this is not the plain validation code.
    expect(SERVER_OWNED_FIELDS).toContain('userId');

    const itemLevel = await push(a, [
      { ...pushItem({ entity: 'expense', id: expenseA.id, fields: { note: 'ok' } }), userId: b.user.id },
    ]);
    expect(itemLevel.status).toBe(200);
    expect(itemLevel.body.results[0]!.status).toBe('invalid');
    expect(itemLevel.body.results[0]!.error?.code).toBe('immutable_field');

    const fieldsLevel = await push(a, [
      pushItem({
        entity: 'expense',
        id: expenseA.id,
        fields: { note: 'ok', userId: b.user.id },
      } as never),
    ]);
    expect(fieldsLevel.status).toBe(200);
    expect(fieldsLevel.body.results[0]!.status).toBe('invalid');
    expect(fieldsLevel.body.results[0]!.error?.code).toBe('immutable_field');

    // The negative, confirmed directly: B holds exactly what the fixture seeded.
    const afterB = {
      expenses: (await api().get('/v1/expenses').set('Authorization', b.auth)).body,
      categories: (await api().get('/v1/categories').set('Authorization', b.auth)).body,
    };
    expect(afterB).toEqual(beforeB);
  });
});

describe('API-03 — unknown fields are rejected everywhere', () => {
  it('is 400 validation_error on the seven REST bodies and the two query strings', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });
    const category = user.categories.Transport!;

    const shapes: ReadonlyArray<[string, Promise<{ status: number; body: unknown; headers: Record<string, string | undefined> }>]> =
      [
        [
          'SignupRequest',
          api().post('/v1/auth/signup').send({ email: uniqueEmail(), password: TEST_PASSWORD, nope: 1 }),
        ],
        [
          'LoginRequest',
          api().post('/v1/auth/login').send({ email: user.user.email, password: TEST_PASSWORD, nope: 1 }),
        ],
        [
          'RefreshRequest',
          api().post('/v1/auth/refresh').send({ refreshToken: user.refreshToken, nope: 1 }),
        ],
        [
          'CategoryCreateRequest',
          api().post('/v1/categories').set('Authorization', user.auth).send({ name: 'Books', nope: 1 }),
        ],
        [
          'CategoryUpdateRequest',
          api()
            .patch(`/v1/categories/${category.id}`)
            .set('Authorization', user.auth)
            .send({ name: 'Commuting', nope: 1 }),
        ],
        [
          'ExpenseCreateRequest',
          api()
            .post('/v1/expenses')
            .set('Authorization', user.auth)
            .send({ categoryId: category.id, amountMinor: 1, date: '2026-10-06', nope: 1 }),
        ],
        [
          'ExpenseUpdateRequest',
          api()
            .patch(`/v1/expenses/${expense.id}`)
            .set('Authorization', user.auth)
            .send({ amountMinor: 2, nope: 1 }),
        ],
        [
          'SyncPushRequest envelope',
          api().post('/v1/sync').set('Authorization', user.auth).send({ changes: [], nope: 1 }),
        ],
        [
          'GET /v1/expenses?nope=1',
          api().get('/v1/expenses?nope=1').set('Authorization', user.auth),
        ],
        ['GET /v1/sync?nope=1', api().get('/v1/sync?nope=1').set('Authorization', user.auth)],
      ] as never;

    for (const [label, pending] of shapes) {
      const response = await pending;
      expectEnvelope(response, 'validation_error');
      const issues = (response.body as ApiError).error.details?.issues ?? [];
      expect(
        namesKey(issues, 'nope'),
        `${label} did not name the unexpected key: ${JSON.stringify(issues)}`,
      ).toBe(true);
    }
  });

  // The contract says `path` is the handle, and for the one failure a closed-schema API
  // produces most often - an unexpected key - zod leaves it empty and puts the key in `keys`.
  // `toIssues` expands that into one entry per key.
  it('names the unexpected key in details.issues[].path, not only in the message', async () => {
    const user = await createUser();
    const response = await api()
      .post('/v1/categories')
      .set('Authorization', user.auth)
      .send({ name: 'Books', nope: 1 });

    const issues = (response.body as ApiError).error.details?.issues ?? [];
    expect(issues.some((issue) => issue.path.includes('nope'))).toBe(true);
  });

  it('is per-record validation_error — not immutable_field — on a push item and its fields', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    const itemLevel = await push(user, [
      { ...pushItem({ entity: 'expense', id: expense.id, fields: { note: 'a' } }), nope: 1 },
    ]);
    expect(itemLevel.status).toBe(200);
    expect(itemLevel.body.results[0]!.status).toBe('invalid');
    // `nope` is not server-owned, so this is the plain code.
    expect(itemLevel.body.results[0]!.error?.code).toBe('validation_error');

    const fieldsLevel = await push(user, [
      pushItem({ entity: 'expense', id: expense.id, fields: { note: 'a', nope: 1 } } as never),
    ]);
    expect(fieldsLevel.status).toBe(200);
    expect(fieldsLevel.body.results[0]!.status).toBe('invalid');
    expect(fieldsLevel.body.results[0]!.error?.code).toBe('validation_error');
  });

  it('fails the batch with the offending index when an item cannot be addressed', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });
    const note = (value: string): Record<string, unknown> => ({ note: value });

    const middle = pushItem({ entity: 'expense', id: expense.id, fields: note('middle') });
    const { clientMutationId: _dropped, ...withoutMutationId } = middle;

    const outcome = await push(user, [
      pushItem({ entity: 'expense', id: expense.id, fields: note('first') }),
      withoutMutationId,
      pushItem({ entity: 'expense', id: expense.id, fields: note('third') }),
    ]);

    expect(outcome.status).toBe(400);
    expect(outcome.error?.code).toBe('validation_error');
    // The index is the only handle the client has on which row to fix.
    const details = outcome.error?.details as { issues?: unknown[] } | undefined;
    const issues = details?.issues ?? [];
    expect(
      JSON.stringify(issues) + String(outcome.error?.message),
      'the batch error named no index 1',
    ).toMatch(/1/);

    // Neither sibling was applied.
    const after = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(after.body.data).toEqual([expense]);
  });
});

describe('API-04 — server-owned fields cannot be set by the client', () => {
  it('is per-record immutable_field on the sync path, for each of the four', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    const values: Record<string, unknown> = {
      revision: 9999,
      createdAt: '2020-01-01T00:00:00.000Z',
      id: expense.id,
      userId: user.user.id,
    };

    for (const field of SERVER_OWNED_FIELDS) {
      const outcome = await push(user, [
        pushItem({
          entity: 'expense',
          id: expense.id,
          fields: { note: 'ok', [field]: values[field] },
        } as never),
      ]);

      expect(outcome.status, `${field} failed the whole batch`).toBe(200);
      const result = outcome.body.results[0]!;
      expect(result.status, `${field} was not rejected`).toBe('invalid');
      expect(result.error?.code, `${field} got the wrong code`).toBe('immutable_field');
      // The message has to name the field or the client cannot tell which key to drop.
      expect(result.error?.message).toContain(field);
    }
  });

  it('is 400 validation_error on the REST path — the 422 is unreachable [BLOCKED-BY-GAP 7]', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    for (const field of SERVER_OWNED_FIELDS) {
      const response = await api()
        .patch(`/v1/expenses/${expense.id}`)
        .set('Authorization', user.auth)
        .send({ [field]: field === 'revision' ? 9999 : expense.id });

      // Recorded as today's behaviour, not as the contract's: `openapi.yaml` still
      // advertises `immutable_field` on four REST operations. GAP 7 owns the divergence.
      expectEnvelope(response, 'validation_error');
      expect(response.status).not.toBe(422);
    }
  });
});

describe('API-05 — the error envelope is the only non-2xx shape', () => {
  it('holds for every code §4–§10 can reach, with no leaked internals', async () => {
    const user = await createUser();
    const other = await createUser();
    const expense = await createExpense(user, { categoryId: user.categories.Groceries!.id });

    const reachable: ReadonlyArray<[ErrorCode, Promise<unknown>]> = [
      ['validation_error', api().post('/v1/expenses').set('Authorization', user.auth).send({})],
      [
        'malformed_request',
        api()
          .post('/v1/expenses')
          .set('Authorization', user.auth)
          .set('Content-Type', 'application/json')
          .send('{'),
      ],
      ['invalid_cursor', api().get('/v1/expenses?cursor=not-a-cursor').set('Authorization', user.auth)],
      [
        'unsupported_media_type',
        api()
          .post('/v1/auth/login')
          .set('Content-Type', 'text/plain')
          .send(JSON.stringify({ email: user.user.email, password: TEST_PASSWORD })),
      ],
      ['unauthorized', api().get('/v1/me')],
      [
        'invalid_credentials',
        api().post('/v1/auth/login').send({ email: user.user.email, password: 'wrong-password-x' }),
      ],
      ['token_invalid', api().post('/v1/auth/refresh').send({ refreshToken: 'v1.never-issued' })],
      [
        'not_found',
        api()
          .delete(
            `/v1/expenses/${(await createExpense(other, { categoryId: other.categories.Groceries!.id })).id}`,
          )
          .set('Authorization', user.auth),
      ],
      [
        'email_already_exists',
        api().post('/v1/auth/signup').send({ email: user.user.email, password: TEST_PASSWORD }),
      ],
      [
        'category_name_taken',
        api().post('/v1/categories').set('Authorization', user.auth).send({ name: 'Groceries' }),
      ],
      [
        'category_not_deletable',
        api().delete(`/v1/categories/${user.defaultCategory.id}`).set('Authorization', user.auth),
      ],
      [
        'unknown_category',
        api()
          .post('/v1/expenses')
          .set('Authorization', user.auth)
          .send({
            categoryId: other.categories.Groceries!.id,
            amountMinor: 1,
            date: '2026-10-06',
          }),
      ],
      [
        'batch_too_large',
        api()
          .post('/v1/sync')
          .set('Authorization', user.auth)
          .send({
            changes: Array.from({ length: LIMITS.SYNC_MAX_BATCH_SIZE + 1 }, () =>
              pushItem({ entity: 'expense', id: expense.id, fields: { note: 'x' } }),
            ),
          }),
      ],
      ['not_found', api().get('/no-such-route')],
      // The plan's step says `/v1/no-such-route`. That is `unauthorized`, not
      // `not_found`: the authenticated router is mounted on `/v1`, so `requireAuth`
      // runs before the 404 handler and an unauthenticated caller cannot learn which
      // `/v1` paths exist. Deliberate, and recorded here because the case's wording
      // implies otherwise.
      ['unauthorized', api().get('/v1/no-such-route')],
      [
        'not_found',
        api().get('/v1/no-such-route').set('Authorization', user.auth),
      ],
    ];

    // Matched against the message and the details text rather than
    // `JSON.stringify(body)`: the first version of this line included an escaped
    // backslash among the forbidden patterns and matched the JSON encoding of the
    // quotes in `Authorization header must be "Bearer <accessToken>"` — i.e. itself.
    const forbidden = /\bat \/|node_modules|SELECT |INSERT |prisma|\.ts:\d|localhost:5432/i;

    for (const [code, pending] of reachable) {
      const response = (await pending) as {
        status: number;
        body: unknown;
        headers: Record<string, string | undefined>;
      };
      expectEnvelope(response, code);
      expect(ERROR_CODES).toContain(code);

      if (code === 'validation_error') {
        expect((response.body as ApiError).error.details?.issues).toBeDefined();
      }
      const envelope = (response.body as ApiError).error;
      expect(envelope.message).not.toMatch(forbidden);
      expect(JSON.stringify(envelope.details ?? {})).not.toMatch(forbidden);
    }

    // And on a 2xx, which is where the id is easiest to lose.
    expectRequestId(await api().get('/v1/me').set('Authorization', user.auth));
  });
});

describe('API-06 — Content-Type is enforced on requests with a body', () => {
  it('is 415 without JSON and 400 malformed_request for an unparseable or absent body', async () => {
    const user = await createUser();
    const credentials = JSON.stringify({ email: user.user.email, password: TEST_PASSWORD });

    expectEnvelope(
      await api().post('/v1/auth/login').set('Content-Type', 'text/plain').send(credentials),
      'unsupported_media_type',
    );
    expectEnvelope(
      await api().post('/v1/auth/login').set('Content-Type', '').send(credentials),
      'unsupported_media_type',
    );
    expectEnvelope(
      await api()
        .post('/v1/expenses')
        .set('Authorization', user.auth)
        .set('Content-Type', 'application/json')
        .send('{'),
      'malformed_request',
    );
    // Step 4 as the plan words it -- "Content-Type: application/json and no body" -- is
    // `validation_error`, not `malformed_request`. Measured, and not something the
    // server can fix: body-parser hands a zero-length JSON body to the handler as `{}`,
    // which is byte-identical to a client that really sent `{}`. The plan's claim that
    // a missing body shares a code with unparseable JSON holds only when no
    // `Content-Type` is sent, which is the assertion after it. `malformed_request`'s own
    // documentation ("or a required body was absent") overpromises by that much.
    expectEnvelope(
      await api()
        .post('/v1/expenses')
        .set('Authorization', user.auth)
        .set('Content-Type', 'application/json')
        .send(''),
      'validation_error',
    );
    expectEnvelope(
      await api().post('/v1/expenses').set('Authorization', user.auth),
      'malformed_request',
    );
  });
});

describe('API-07 — auth is required on exactly the right operations', () => {
  const PUBLIC = new Set(['getHealth', 'signup', 'login', 'refresh', 'logout']);

  it('walks every route in the contract rather than a list kept by hand', async () => {
    // Driven off API_ROUTES so a route added to the contract cannot slip past this case.
    expect(API_ROUTES.filter((route) => !route.auth).map((r) => r.operationId).sort()).toEqual(
      [...PUBLIC].sort(),
    );

    for (const route of API_ROUTES) {
      const path = route.path.replace('{id}', '00000000-0000-7000-8000-000000000000');
      const response = await api()[route.method](path).send(
        route.method === 'get' || route.method === 'delete' ? undefined : {},
      );

      if (PUBLIC.has(route.operationId)) {
        // "Behaves normally" — reached the handler, so not an auth refusal.
        expect(
          response.status,
          `${route.operationId} demanded a token it should not`,
        ).not.toBe(401);
      } else {
        expectEnvelope(response, 'unauthorized');
      }
    }
  });
});

describe('API-08 — health reports the database as part of liveness', () => {
  it('is 200 with db up against a live database', async () => {
    const response = await api().get('/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(response.body.version).toMatch(/\S/);
    expect(Number.isNaN(Date.parse(response.body.time))).toBe(false);
  });

  // Step 2 — stopping Postgres — is not executed here: this suite shares one database
  // with 23 other files in the same run, and stopping it would fail all of them. It is
  // recorded in §2 of the test plan as a manual step against a dedicated instance.
});

describe('API-10 — GET /v1/sync query validation', () => {
  it('rejects the four out-of-range values and defaults to since=0, limit=200', async () => {
    const user = await createUser();
    const get = (query: string) => api().get(`/v1/sync${query}`).set('Authorization', user.auth);

    for (const query of ['?since=-1', '?since=abc', '?limit=0', `?limit=${LIMITS.SYNC_PULL_MAX_LIMIT + 1}`]) {
      expectEnvelope(await get(query), 'validation_error');
    }

    expect((await get(`?limit=${LIMITS.SYNC_PULL_MAX_LIMIT}`)).status).toBe(200);

    // Both omitted: a full download from zero, capped at the default limit.
    const defaulted = await get('');
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.changes.length).toBeLessThanOrEqual(LIMITS.SYNC_PULL_DEFAULT_LIMIT);
    // The six seeded categories are revisions 1..6, so `since=0` is what returns them.
    expect(defaulted.body.changes).toHaveLength(6);
    // `changes` rather than the whole body: `serverTime` is stamped per response and
    // differed by 9ms between the two calls on the first run of this case.
    const explicit = await get('?since=0');
    expect(explicit.body.changes).toEqual(defaulted.body.changes);
    expect(explicit.body.nextCursor).toBe(defaulted.body.nextCursor);
    expect(explicit.body.hasMore).toBe(defaulted.body.hasMore);
  });
});

describe('API-11 — GET /v1/expenses query validation', () => {
  it('rejects the out-of-range limits and every malformed value', async () => {
    const user = await createUser();
    const get = (query: string) => api().get(`/v1/expenses${query}`).set('Authorization', user.auth);

    for (const query of [
      '?limit=0',
      `?limit=${LIMITS.EXPENSE_LIST_MAX_LIMIT + 1}`,
      '?from=2026-13-01',
      '?from=06-10-2026',
      '?categoryId=not-a-uuid',
      // Not `includeDeleted=yes`, which the plan listed as a malformed value: the schema
      // is a zod `stringbool`, whose truthy set includes `yes`, `y`, `on`, `1` and
      // `enabled`. Measured below. `openapi.yaml` declares the same parameter
      // `type: boolean`, so the two disagree -- filed separately.
      '?includeDeleted=maybe',
      '?includeDeleted=2',
    ]) {
      expectEnvelope(await get(query), 'validation_error');
    }

    expect((await get(`?limit=${LIMITS.EXPENSE_LIST_MAX_LIMIT}`)).status).toBe(200);

    // The stringbool forms the schema does define, and that `openapi.yaml` does not.
    for (const value of ['true', 'false', 'yes', 'y', 'on', '1', 'enabled', 'TRUE']) {
      expect((await get(`?includeDeleted=${value}`)).status, value).toBe(200);
    }
  });

  it('holds the page to 50 when limit is omitted', async () => {
    const user = await createUser();
    const categoryId = user.categories.Groceries!.id;
    // 51 rows: one more than the default, so a page of 51 would be visible.
    for (let i = 0; i < LIMITS.EXPENSE_LIST_DEFAULT_LIMIT + 1; i += 1) {
      await createExpense(user, { categoryId, amountMinor: 100 + i, date: '2026-10-06' });
    }

    const response = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(LIMITS.EXPENSE_LIST_DEFAULT_LIMIT);
    expect(response.body.hasMore).toBe(true);
  });
});
