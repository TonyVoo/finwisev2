import { API_ROUTES, type ApiOperationId, routeKey } from '@expense-tracker/shared';
import { type ApiClient, createApiClient, resolvePath } from '@/api/client';
import { ENDPOINTS } from '@/api/endpoints';
import { ApiRequestError, ResponseShapeError, UNKNOWN_ERROR_CODE } from '@/api/errors';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';

function clientReturning(response: TransportResponse) {
  const seen: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    seen.push(request);
    return response;
  };
  return { client: createApiClient({ transport }), seen };
}

const CATEGORY = {
  id: '0192f5a0-0000-7000-8000-000000000001',
  name: 'Groceries',
  color: '#2F8044',
  isDefault: false,
  monthlyBudgetMinor: null,
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z',
  deletedAt: null,
  revision: 7,
};

describe('the endpoint table', () => {
  // The contract is the source of truth for the HTTP surface. A route added there and
  // forgotten here would surface as a 404 from a route that exists.
  it('covers every route in the contract, and no others', () => {
    const declared = Object.values(ENDPOINTS).map((endpoint) => routeKey(endpoint.route));
    const contract = API_ROUTES.map(routeKey);
    expect([...declared].sort()).toEqual([...contract].sort());
  });

  it('keys each endpoint by the operation it implements', () => {
    for (const [name, endpoint] of Object.entries(ENDPOINTS)) {
      expect(endpoint.route.operationId).toBe(name);
    }
  });

  it('takes the auth requirement from the contract rather than restating it', () => {
    expect(ENDPOINTS.getHealth.route.auth).toBe(false);
    expect(ENDPOINTS.login.route.auth).toBe(false);
    // Refresh is unauthenticated by design: the access token it replaces has expired.
    expect(ENDPOINTS.refresh.route.auth).toBe(false);
    expect(ENDPOINTS.pullSync.route.auth).toBe(true);
    expect(ENDPOINTS.pushSync.route.auth).toBe(true);
  });

  it('expects no body only where the contract answers 204', () => {
    for (const endpoint of Object.values(ENDPOINTS)) {
      expect(endpoint.responseSchema === null).toBe(endpoint.route.successStatus === 204);
    }
  });
});

/**
 * Every method on the client, against the route the contract gives the operation it is
 * named for.
 *
 * The endpoint table above is checked key-by-key, but nothing checked that
 * `client.deleteExpense` reaches for `ENDPOINTS.deleteExpense` rather than a neighbour.
 * TypeScript will not catch that: `send` is typed by the endpoint's response schema, and
 * the three expense writes all answer `ExpenseResponse`, as do the three category writes,
 * as do signup and login with `AuthResponse`. So `deleteExpense` wired to
 * `ENDPOINTS.updateExpense` compiles cleanly and issues a `PATCH` where the user asked
 * for a delete - and the reverse sends `DELETE` when they asked to edit an amount.
 *
 * Eight of the then-sixteen methods had no test at all before this table.
 */
// `API-12`. TypeScript cannot catch a method reaching for a neighbour's route: the three
// expense writes all answer `ExpenseResponse`, as do the three category writes, as do signup
// and login. Swapping `updateExpense` and `deleteExpense` leaves `tsc` clean.
describe('every client method', () => {
  const ID = '0192f5a0-0000-7000-8000-0000000000aa';

  // A 400 envelope, so one transport serves every method without a valid success
  // bodies. The request is recorded before the status is read.
  const REJECTED: TransportResponse = {
    status: 400,
    body: { error: { code: 'validation_error', message: 'no' } },
    requestId: null,
  };

  const CALLS: ReadonlyArray<readonly [ApiOperationId, (client: ApiClient) => Promise<unknown>]> = [
    ['getHealth', (client) => client.getHealth()],
    ['signup', (client) => client.signup({ email: 'a@example.com', password: 'correct horse 42' })],
    ['login', (client) => client.login({ email: 'a@example.com', password: 'correct horse 42' })],
    ['refresh', (client) => client.refresh({ refreshToken: 'r' })],
    ['logout', (client) => client.logout({ refreshToken: 'r' })],
    ['forgotPassword', (client) => client.forgotPassword({ email: 'a@example.com' })],
    [
      'resetPassword',
      (client) =>
        client.resetPassword({
          email: 'a@example.com',
          code: '123456',
          newPassword: 'correct horse 42',
        }),
    ],
    ['getMe', (client) => client.getMe()],
    [
      'changePassword',
      (client) => client.changePassword({ currentPassword: 'a', newPassword: 'correct horse 42' }),
    ],
    ['changeEmail', (client) => client.changeEmail({ email: 'b@example.com', password: 'a' })],
    ['requestEmailVerification', (client) => client.requestEmailVerification({})],
    ['confirmEmailVerification', (client) => client.confirmEmailVerification({ code: '123456' })],
    ['deleteAccount', (client) => client.deleteAccount({ password: 'a' })],
    [
      'putReceipt',
      (client) =>
        client.putReceipt(ID, {
          contentType: 'image/jpeg',
          dataBase64: '/9j/AAAA',
        }),
    ],
    ['getReceipt', (client) => client.getReceipt(ID)],
    ['deleteReceipt', (client) => client.deleteReceipt(ID)],
    ['listReceipts', (client) => client.listReceipts()],

    ['listCategories', (client) => client.listCategories()],
    ['createCategory', (client) => client.createCategory({ name: 'Rent' })],
    ['updateCategory', (client) => client.updateCategory(ID, { name: 'Rent' })],
    ['deleteCategory', (client) => client.deleteCategory(ID)],

    ['listExpenses', (client) => client.listExpenses()],
    [
      'createExpense',
      (client) => client.createExpense({ categoryId: ID, amountMinor: 1, date: '2026-10-10' }),
    ],
    ['updateExpense', (client) => client.updateExpense(ID, { amountMinor: 2 })],
    ['deleteExpense', (client) => client.deleteExpense(ID)],

    ['pullSync', (client) => client.pullSync({ since: 0 })],
    ['pushSync', (client) => client.pushSync({ changes: [] })],
  ];

  it('covers the whole client surface', () => {
    expect(CALLS.map(([operationId]) => operationId).sort()).toEqual(
      API_ROUTES.map((route) => route.operationId).sort(),
    );
  });

  it.each(CALLS)(
    '%s issues the method, path and auth flag the contract declares',
    async (operationId, call) => {
      const route = API_ROUTES.find((candidate) => candidate.operationId === operationId)!;
      const { client, seen } = clientReturning(REJECTED);

      await call(client).catch(() => undefined);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        method: route.method,
        path: resolvePath(route.path, { id: ID }),
        requiresAuth: route.auth,
      });
    },
  );
});

describe('resolvePath', () => {
  it('substitutes path parameters', () => {
    expect(resolvePath('/v1/categories/{id}', { id: 'abc' })).toBe('/v1/categories/abc');
  });

  it('percent-encodes them', () => {
    expect(resolvePath('/v1/expenses/{id}', { id: 'a/b' })).toBe('/v1/expenses/a%2Fb');
  });

  // Sending the literal `{id}` would read as a 404 from a route that exists.
  it('throws rather than sending an unsubstituted placeholder', () => {
    expect(() => resolvePath('/v1/categories/{id}')).toThrow(/Missing path parameter id/);
  });
});

describe('createApiClient', () => {
  it('sends the method, path and auth flag the contract declares', async () => {
    const { client, seen } = clientReturning({
      status: 200,
      body: { data: [CATEGORY] },
      requestId: null,
    });

    await client.listCategories();

    expect(seen[0]).toMatchObject({ method: 'get', path: '/v1/categories', requiresAuth: true });
  });

  it('substitutes the id into a parameterised route', async () => {
    const { client, seen } = clientReturning({
      status: 200,
      body: { data: CATEGORY },
      requestId: null,
    });

    await client.updateCategory(CATEGORY.id, { name: 'Food' });

    expect(seen[0]).toMatchObject({
      method: 'patch',
      path: `/v1/categories/${CATEGORY.id}`,
      body: { name: 'Food' },
    });
  });

  it('passes a query through to the transport', async () => {
    const { client, seen } = clientReturning({
      status: 200,
      body: {
        changes: [],
        nextCursor: 12,
        hasMore: false,
        resyncRequired: false,
        serverTime: '2026-10-08T10:00:00.000Z',
      },
      requestId: null,
    });

    await client.pullSync({ since: 12, limit: 200 });

    expect(seen[0]!.query).toEqual({ since: 12, limit: 200 });
  });

  it('returns the parsed body on success', async () => {
    const { client } = clientReturning({
      status: 200,
      body: { data: [CATEGORY] },
      requestId: null,
    });

    await expect(client.listCategories()).resolves.toEqual({ data: [CATEGORY] });
  });

  it('resolves to nothing for a 204 route', async () => {
    const { client } = clientReturning({ status: 204, body: undefined, requestId: null });
    await expect(client.logout({ refreshToken: 'r' })).resolves.toBeUndefined();
  });

  describe('errors', () => {
    it('turns the error envelope into an ApiRequestError', async () => {
      const { client } = clientReturning({
        status: 409,
        body: {
          error: {
            code: 'category_name_taken',
            message: 'Another category already uses that name',
          },
        },
        requestId: 'req-9',
      });

      const error = await client.createCategory({ name: 'Groceries' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        status: 409,
        // The stable machine-readable half of the contract - this is what callers branch
        // on, never `message`.
        code: 'category_name_taken',
        requestId: 'req-9',
      });
    });

    it('keeps validation details so a form can mark its fields', async () => {
      const { client } = clientReturning({
        status: 400,
        body: {
          error: {
            code: 'validation_error',
            message: 'Request failed validation',
            details: { issues: [{ path: 'amountMinor', message: 'must be an integer' }] },
          },
        },
        requestId: null,
      });

      const error = (await client
        .createExpense({
          categoryId: CATEGORY.id,
          amountMinor: 1,
          date: '2026-10-08',
        })
        .catch((e: unknown) => e)) as ApiRequestError;

      expect(error.details?.issues).toEqual([
        { path: 'amountMinor', message: 'must be an integer' },
      ]);
    });

    // A proxy's HTML 502 is still a real status worth reporting, so it degrades rather
    // than throwing a second error that hides the first.
    it('degrades to an unknown code when the body is not the envelope', async () => {
      const { client } = clientReturning({ status: 502, body: undefined, requestId: null });

      const error = (await client.getMe().catch((e: unknown) => e)) as ApiRequestError;

      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error.code).toBe(UNKNOWN_ERROR_CODE);
      expect(error.status).toBe(502);
    });

    it('rejects a success body the contract does not describe', async () => {
      const { client } = clientReturning({
        status: 200,
        // `revision` missing: a shape the shared schema does not allow.
        body: { data: [{ ...CATEGORY, revision: undefined }] },
        requestId: null,
      });

      // Loud, rather than letting `undefined` spread through the sync engine as a
      // cursor. Both sides ship from the same `shared/`, so this is a bug, not an
      // older server.
      await expect(client.listCategories()).rejects.toThrow(ResponseShapeError);
    });

    it('names the offending field in the shape error', async () => {
      const { client } = clientReturning({
        status: 200,
        body: { data: { ...CATEGORY, color: 'rebeccapurple' } },
        requestId: null,
      });

      await expect(client.deleteCategory(CATEGORY.id)).rejects.toThrow(/color/);
    });
  });
});
