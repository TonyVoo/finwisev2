import { DEFAULT_CATEGORIES, type AuthResponse, type Expense } from '@expense-tracker/shared';
import { createServer, type Server } from 'node:http';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthorizedTransport, type TokenSource } from '../../mobile/src/api/authorize.ts';
import { type ApiClient, createApiClient } from '../../mobile/src/api/client.ts';
import { ApiRequestError, NetworkUnavailableError } from '../../mobile/src/api/errors.ts';
import { createTransport, type Transport } from '../../mobile/src/api/transport.ts';
import { createSessionController } from '../../mobile/src/auth/session.ts';
import { createMemoryTokenStore } from '../../mobile/src/auth/sessionRecord.ts';
import { createMemoryLocalStore } from '../../mobile/src/db/localStore.ts';
import { signAccessToken } from '../src/auth/accessToken.ts';
import { hashRefreshToken } from '../src/auth/refreshToken.ts';
import { createApp } from '../src/app.ts';
import { getPrisma } from '../src/db/client.ts';
import { TEST_PASSWORD, uniqueEmail } from './support/api.ts';

/**
 * The mobile client against the real API, over real HTTP.
 *
 * Every other suite in this repo tests one side of this seam with the other side faked:
 * the backend files drive `createApp()` through supertest with hand-written request
 * bodies, and the mobile files drive the client through an injected `fetchImpl` that
 * answers with hand-written response bodies. Both can be green while disagreeing with
 * each other, because the thing they disagree about is never built by one and read by
 * the other in the same process.
 *
 * TypeScript does not close that gap either. It proves both sides reference the same
 * `shared/` types; it cannot prove the bytes Express parses are the bytes
 * `buildQueryString` produced, that an opaque cursor survives a real URL, that the server
 * actually sets the `X-Request-Id` the client reads off the response object, or that a
 * 204 with a genuinely empty body comes back as `undefined` rather than a parse failure.
 *
 * So this file is deliberately thin on new behaviour and entirely about the join. It
 * boots the real app on an ephemeral port and drives the real `createTransport`,
 * `createAuthorizedTransport` and `createApiClient` against it through the global
 * `fetch`.
 *
 * **One thing it cannot test, measured rather than assumed.** The client parses every
 * response against a *strict* schema, so an undocumented server field is a
 * `ResponseShapeError` on a device — but that path is unreachable from here, because
 * `http/respond.ts` parses each body against the same schema before sending and throws,
 * which arrives as a 500. Probed by making `toWireCategory` emit a non-ISO `createdAt`:
 * 182 backend cases failed on 500s, and not one of them was a response-shape failure in
 * this file. Worth knowing in both directions, since `validateResponses` is
 * `!isProduction` — in production the server's own check is off and the client's strict
 * parse is the only thing left, which is why that path belongs in the mobile suite's
 * scripted-transport cases and not here.
 *
 * **What is faked, and what no longer is.** The 401 interceptor — `api/authorize.ts` —
 * used to be unreachable from this file, and not for a runtime reason: a *type-only*
 * import of `SessionController` put `auth/session.ts` in this package's TypeScript
 * program, which pulled `auth/tokenStore.ts`, `expo-secure-store`, `expo-modules-core`,
 * `react-native` and `@types/jsdom`, which references `lib.dom` — and with the DOM
 * globals loaded, `setTimeout` in `backend/src/server.ts` returned a `number` with no
 * `unref`, so the backend failed its own typecheck in two files nobody touched. Fixed in
 * `TVO-23` by having the interceptor declare the two members it calls (`TokenSource`)
 * instead of importing the whole session type, so the real interceptor now wraps every
 * client below and `API-19` asserts its choreography against a server that really
 * answers `401 token_expired`.
 *
 * One layer further up — the `SessionController` that supplies the tokens — used to be
 * faked here too, and for a second reason: it could be *typed* after `TVO-23` but not
 * *loaded*, because it imports `sessionFromTokenPair` from `auth/tokenStore.ts`, whose
 * first line was `import * as SecureStore from 'expo-secure-store'`, and Vite cannot
 * parse `react-native/index.js`. `TVO-33` moved the session shape and the in-memory
 * store into `auth/sessionRecord.ts`, which imports nothing but `shared/`, leaving
 * `expo-secure-store` behind the one implementation that needs it. So `API-26` now
 * constructs the real controller against the real server and pins the rule that could
 * not be checked here before: two concurrent 401s produce exactly one rotation of a
 * refresh token the server really does revoke.
 *
 * The lighter `TokenSource`s below are still used where a case is about the interceptor
 * rather than the controller, and the controller's remaining rules — its storage
 * ordering, its offline behaviour, its forced clear — stay covered by the scripted cases
 * in `mobile/tests/api/authorize.test.ts` and the mobile session suite.
 */

let server: Server;
let baseUrl: string;
/**
 * Every round trip, in order, as it actually went out: method, path **with the query
 * string the transport built**, and the status that came back. Recorded at the `fetch`
 * boundary rather than at the transport's own interface, because the URL is assembled
 * inside the transport and is exactly what several of these cases are about.
 */
let trips: Array<{ method: string; url: string; status: number }>;

beforeAll(async () => {
  server = createServer(createApp());
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server did not bind a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  trips = [];
});

/** The real transport, recording at the `fetch` boundary it sends through. */
function recordingTransport(): Transport {
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    trips.push({
      method: init?.method ?? 'GET',
      url: String(input).slice(baseUrl.length),
      status: response.status,
    });
    return response;
  };
  return createTransport({ baseUrl, fetchImpl });
}

/**
 * The query parameters of a recorded URL, sorted.
 *
 * Sorted because the order `URLSearchParams` emits follows the order the keys were
 * written on the call site's object literal, which no part of the contract depends on.
 * What the cases below assert is which parameters went out and with what values.
 */
function paramsOf(url: string): string[] {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  return [...new URLSearchParams(query)].map(([key, value]) => `${key}=${value}`).sort();
}

/**
 * A session holding one access token that it cannot replace.
 *
 * Enough for every case that is not about the 401 handling: the real interceptor attaches
 * this token, and on a 401 finds there is no fresher one and hands the original response
 * back (rule 4, "never swallow the 401"). `API-15`'s expired-token leg is that branch
 * running against a real `401 token_expired`.
 */
function fixedToken(token: () => string): TokenSource {
  return {
    getAccessToken: async () => token(),
    getEpoch: () => 0,
    ensureFreshAccessToken: async () => null,
  };
}

/**
 * A session that really refreshes: one replaceable access token, and the rotation
 * performed by the same server the request went to.
 *
 * Stands in for `createSessionController` only because that cannot be loaded here (see
 * the note at the top). It keeps the two properties the interceptor's contract leans on:
 * the refresh goes out on the **unauthenticated** transport, so it cannot recurse into
 * the interceptor that triggered it, and a caller whose stale token has already been
 * replaced gets the current one rather than a second rotation — the refresh token is
 * single-use, so rotating twice would revoke the pair.
 */
function refreshingSession(
  anonymous: ApiClient,
  initial: { readonly access: string; readonly refresh: string },
): TokenSource {
  let access = initial.access;
  let refresh = initial.refresh;
  return {
    getAccessToken: async () => access,
    getEpoch: () => 0,
    ensureFreshAccessToken: async (stale) => {
      if (stale !== access) return access;
      const pair = await anonymous.refresh({ refreshToken: refresh });
      access = pair.accessToken;
      refresh = pair.refreshToken;
      return access;
    },
  };
}

/** A signed-up user, plus a client whose requests carry their token. */
async function signedIn(): Promise<{
  auth: AuthResponse;
  client: ApiClient;
  anonymous: ApiClient;
}> {
  const transport = recordingTransport();
  const anonymous = createApiClient({ transport });
  const auth = await anonymous.signup({ email: uniqueEmail('seam'), password: TEST_PASSWORD });
  const client = createApiClient({
    transport: createAuthorizedTransport(
      transport,
      fixedToken(() => auth.accessToken),
    ),
  });
  return { auth, client, anonymous };
}

describe('API-13 — the correlation id the contract promises on every response', () => {
  it('is present on a success and on an error, read off the real header', async () => {
    const transport = recordingTransport();

    const health = await transport({
      method: 'get',
      path: '/v1/health',
      requiresAuth: false,
    });
    expect(health.status).toBe(200);
    expect(health.requestId).not.toBeNull();

    // No token at all: the 401 comes from middleware, which is where a correlation id is
    // easiest to lose, and is also the response a user is most likely to report.
    const unauthorized = await transport({
      method: 'get',
      path: '/v1/me',
      requiresAuth: true,
      accessToken: null,
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.requestId).not.toBeNull();
    expect(unauthorized.requestId).not.toBe(health.requestId);
  });
});

describe('API-14 — the client and the server agree on the whole REST surface', () => {
  it('signs up, reads, writes and deletes without a single response-shape failure', async () => {
    const { auth, client } = await signedIn();

    // `getMe` proves the `Authorization: Bearer` the transport builds is the header the
    // server's parser accepts. An unauthorized transport answered "Authorization header
    // must be Bearer <accessToken>" while this file was being written, which is the
    // shape of failure this case exists to catch.
    const me = await client.getMe();
    expect(me.user.id).toBe(auth.user.id);

    const categories = await client.listCategories();
    expect(categories.data).toHaveLength(6);
    const target = categories.data.find((category) => !category.isDefault);
    if (target === undefined) throw new Error('signup seeded no non-default category');

    const renamed = await client.updateCategory(target.id, { name: 'Commuting' });
    expect(renamed.data.name).toBe('Commuting');

    const created = await client.createExpense({
      categoryId: target.id,
      amountMinor: 1234,
      date: '2026-10-06',
      note: 'seam',
    });
    expect(created.data.categoryId).toBe(target.id);

    const patched = await client.updateExpense(created.data.id, { amountMinor: 999 });
    expect(patched.data.amountMinor).toBe(999);

    const deletedExpense = await client.deleteExpense(created.data.id);
    expect(deletedExpense.data.deletedAt).not.toBeNull();

    const deletedCategory = await client.deleteCategory(target.id);
    expect(deletedCategory.data.deletedAt).not.toBeNull();

    // Every one of those calls ran a real body through the client's own response schema,
    // so reaching here means the client accepted eleven real bodies without a
    // `ResponseShapeError`. What it does not prove is that the client would catch a bad
    // one: in this configuration `sendJson` refuses to emit it first. See the note at the
    // top of the file.
    const create = trips.find((trip) => trip.method === 'POST' && trip.url === '/v1/expenses');
    expect(create?.status).toBe(201);
    expect(trips.every((trip) => trip.status < 400)).toBe(true);
  });
});

describe('API-15 — a refresh through the client rotates the pair and spends the old one', () => {
  it('accepts the rotated access token and refuses the token it replaced', async () => {
    const transport = recordingTransport();
    const anonymous = createApiClient({ transport });
    const auth = await anonymous.signup({ email: uniqueEmail('rotate'), password: TEST_PASSWORD });

    // An access token the server itself signed with a negative TTL: well-formed,
    // correctly signed, already expired. This is the state a backgrounded app wakes in,
    // and the server has to answer it `token_expired` rather than `token_invalid`,
    // because the client's reaction to the two differs — refresh versus log out.
    const expired = await signAccessToken(auth.user.id, -60);
    const stale = createApiClient({
      transport: createAuthorizedTransport(
        transport,
        fixedToken(() => expired.token),
      ),
    });
    await expect(stale.getMe()).rejects.toMatchObject({ status: 401, code: 'token_expired' });

    const rotated = await anonymous.refresh({ refreshToken: auth.refreshToken });
    expect(rotated.refreshToken).not.toBe(auth.refreshToken);

    /*
     * Measured here rather than assumed, because the first version of this case asserted
     * the opposite and failed: `rotated.accessToken` can be **byte-identical** to the one
     * signup issued. The access token is an HS256 JWT over an empty payload with no
     * `jti`, so for one user it is a pure function of `iat`/`exp` — two tokens minted in
     * the same second are the same string.
     *
     * It is not a defect on its own: a token that has *expired* was minted an hour ago,
     * so its `exp` differs and the comparison `authorize.ts` rule 3 and
     * `session.ts`'s `ensureFreshAccessToken` make does distinguish it. It is worth
     * knowing because both of those treat the token string as the session's identity,
     * and this is a case where the string is not unique. `AUTH-23`/`AUTH-24` already
     * recommend an epoch counter instead; this is a second reason for it.
     */
    expect(typeof rotated.accessToken).toBe('string');

    const fresh = createApiClient({
      transport: createAuthorizedTransport(
        transport,
        fixedToken(() => rotated.accessToken),
      ),
    });
    expect((await fresh.getMe()).user.id).toBe(auth.user.id);

    // Single-use: the refresh token the client arrived with is spent, so a client that
    // kept the old one is logged out on its next refresh.
    await expect(anonymous.refresh({ refreshToken: auth.refreshToken })).rejects.toMatchObject({
      status: 401,
      code: 'token_invalid',
    });
  });
});

describe('API-16 — query parameters and a real keyset cursor survive the URL', () => {
  let client: ApiClient;
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];

  beforeEach(async () => {
    const signed = await signedIn();
    client = signed.client;
    const categories = await client.listCategories();
    const categoryId = categories.data[0]!.id;
    for (const date of dates) {
      await client.createExpense({ categoryId, amountMinor: 100, date });
    }
    trips = [];
  });

  it('drops a parameter explicitly set to undefined instead of serialising it', async () => {
    const all = await client.listExpenses();
    expect(all.data).toHaveLength(3);
    expect(all.hasMore).toBe(false);
    expect(all.nextCursor).toBeNull();
    expect(trips[0]?.url).toBe('/v1/expenses');

    // The pattern app code reaches for the moment paging exists:
    // `{ cursor: nextCursor ?? undefined }`. `exactOptionalPropertyTypes` is off in
    // `tsconfig.base.json`, so this compiles, and the key is present on the object with
    // an `undefined` value — which is the only way `buildQueryString`'s skip branch is
    // reachable at all. Serialising it would put `cursor=undefined` on the wire and the
    // strict query schema would answer 400.
    const narrowed = await client.listExpenses({
      limit: 2,
      cursor: undefined,
      categoryId: undefined,
    });
    expect(narrowed.data).toHaveLength(2);
    expect(paramsOf(trips.at(-1)!.url)).toEqual(['limit=2']);
  });

  it('paginates with the cursor it was given, with no overlap and no gap', async () => {
    const first = await client.listExpenses({ limit: 2, from: '2026-10-01', to: '2026-10-03' });
    expect(paramsOf(trips.at(-1)!.url)).toEqual(['from=2026-10-01', 'limit=2', 'to=2026-10-03']);
    expect(first.data).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await client.listExpenses({ limit: 2, cursor: first.nextCursor! });
    expect(second.data).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    const seen = [...first.data, ...second.data].map((expense: Expense) => expense.date);
    expect(new Set(seen).size).toBe(3);
    expect([...seen].sort()).toEqual([...dates].sort());
  });

  it('rejects a bound the contract forbids, with the documented code', async () => {
    await expect(
      client.listExpenses({ from: '2026-10-03', to: '2026-10-01' }),
    ).rejects.toMatchObject({ status: 400, code: 'validation_error' });
  });
});

describe('API-17 — a push batch and a pull page, built and parsed by the client', () => {
  it('syncs a category and an expense assigned to it in one round trip', async () => {
    const { client } = await signedIn();

    const categoryId = uuidv7();
    const expenseId = uuidv7();
    const updatedAt = new Date().toISOString();

    const pushed = await client.pushSync({
      changes: [
        {
          entity: 'category',
          id: categoryId,
          updatedAt,
          clientMutationId: uuidv7(),
          fields: { name: 'Offline', color: '#336699' },
        },
        {
          entity: 'expense',
          id: expenseId,
          updatedAt,
          clientMutationId: uuidv7(),
          fields: { categoryId, amountMinor: 2500, date: '2026-10-07' },
        },
      ],
    });

    expect(pushed.results.map((result) => result.status)).toEqual(['applied', 'applied']);

    const full = await client.pullSync({ since: 0 });
    expect(full.resyncRequired).toBe(false);
    const pulled = new Map(full.changes.map((change) => [change.record.id, change]));
    expect(pulled.get(categoryId)?.entity).toBe('category');
    const expense = pulled.get(expenseId);
    if (expense?.entity !== 'expense') throw new Error('the pushed expense did not come back');
    expect(expense.record.categoryId).toBe(categoryId);

    // A pull from the watermark the server just handed back is the steady state a synced
    // client sits in: no changes, and the same cursor returned rather than 0.
    const idle = await client.pullSync({ since: full.nextCursor });
    expect(idle.changes).toEqual([]);
    expect(idle.nextCursor).toBe(full.nextCursor);
    expect(idle.hasMore).toBe(false);
  });
});

describe('API-18 — a 204 and a real error envelope, as the client sees them', () => {
  it('resolves logout with no body and then refuses the revoked token', async () => {
    const { anonymous, auth } = await signedIn();

    trips = [];
    await expect(anonymous.logout({ refreshToken: auth.refreshToken })).resolves.toBeUndefined();
    expect(trips[0]).toEqual({ method: 'POST', url: '/v1/auth/logout', status: 204 });

    await expect(anonymous.refresh({ refreshToken: auth.refreshToken })).rejects.toMatchObject({
      status: 401,
      code: 'token_invalid',
    });
  });

  it('turns a 422 into an ApiRequestError carrying the code and the correlation id', async () => {
    const { client } = await signedIn();

    const thrown = await client
      .createExpense({ categoryId: uuidv7(), amountMinor: 100, date: '2026-10-06' })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(thrown).toBeInstanceOf(ApiRequestError);
    const apiError = thrown as ApiRequestError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe('unknown_category');
    // The id is only here if the server set the header and the transport read it back off
    // a real response. It is what the contract tells a user to quote in a bug report.
    expect(apiError.requestId).not.toBeNull();
  });
});

describe("API-19 — the 401 interceptor's own round trip against a real server", () => {
  it('refreshes once, retries once, and resolves for the right user', async () => {
    const transport = recordingTransport();
    const anonymous = createApiClient({ transport });
    const auth = await anonymous.signup({
      email: uniqueEmail('intercept'),
      password: TEST_PASSWORD,
    });

    /*
     * The state a backgrounded app wakes in, and the reason the interceptor exists:
     * access tokens live an hour and the app runs for days. The token is signed by the
     * server itself with a negative TTL, so it is well-formed and genuinely expired
     * rather than merely rejected, and the server has to answer it `token_expired`.
     *
     * It is also what keeps rule 3 out of the way: the rotated token differs from this
     * one because their `exp` differs. `API-15` measured the case where it does not -
     * two tokens minted for one user in the same second are byte-identical, since the
     * access token is an HS256 JWT over an empty payload with no `jti`.
     */
    const expired = await signAccessToken(auth.user.id, -60);
    const client = createApiClient({
      transport: createAuthorizedTransport(
        transport,
        refreshingSession(anonymous, { access: expired.token, refresh: auth.refreshToken }),
      ),
    });

    trips = [];
    const me = await client.getMe();
    expect(me.user.id).toBe(auth.user.id);

    /*
     * The whole case is in this one assertion, and it is why it is `toEqual` on the
     * sequence rather than a count or a `some`. Three trips in this order is one refresh
     * and one retry: a fourth `GET /v1/me` would be rule 1 broken (retry at most once),
     * a second `POST /v1/auth/refresh` would be two rotations of a single-use token, and
     * two trips with a resolved promise would mean a 401 was swallowed as a success.
     *
     * The refresh in the middle is on the unauthenticated client, so it is recorded here
     * exactly as it goes out in the app - the interceptor does not wrap it.
     */
    expect(trips).toEqual([
      { method: 'GET', url: '/v1/me', status: 401 },
      { method: 'POST', url: '/v1/auth/refresh', status: 200 },
      { method: 'GET', url: '/v1/me', status: 200 },
    ]);
  });
});

describe('API-26 — the real SessionController against a real server', () => {
  it('serves two concurrent 401s with one refresh, and the token it did not spend is dead', async () => {
    /*
     * The barrier. Both requests must be parked on the *same* in-flight refresh for this
     * case to be about `inFlightRefresh` at all, and without a gate that is a race:
     * `ensureFreshAccessToken` has two ways to answer with one refresh, and which one
     * runs depends on whether the second 401 lands before the rotation commits. The
     * other way - the staleness early return at `session.accessToken !== stale` - is
     * already covered by `refreshingSession` and by the scripted mobile cases.
     *
     * So the refresh is held until two 401s have come back. Then the second caller
     * provably arrives while the first rotation is still open, which is the one ordering
     * where a controller without single-flight sends a second rotation. If only one 401
     * ever happens this times out, and that is the right failure: it would mean one of
     * the two requests never reached the interceptor.
     */
    let bothUnauthorized!: () => void;
    const parked = new Promise<void>((resolve) => {
      bothUnauthorized = resolve;
    });
    let unauthorized = 0;

    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      trips.push({
        method: init?.method ?? 'GET',
        url: String(input).slice(baseUrl.length),
        status: response.status,
      });
      if (response.status === 401 && ++unauthorized === 2) bothUnauthorized();
      return response;
    };

    const transport = createTransport({ baseUrl, fetchImpl });
    const anonymous = createApiClient({ transport });
    const auth = await anonymous.signup({
      email: uniqueEmail('controller'),
      password: TEST_PASSWORD,
    });

    /*
     * The real controller, wired the way `bootstrap/container.ts` wires it: an in-memory
     * token store, an in-memory local store, and `refreshTokens` pointed at the
     * *unauthenticated* client so a refresh cannot recurse into the interceptor that
     * triggered it. Loadable here at all only since `TVO-33` moved the session shape out
     * of `auth/tokenStore.ts` and away from `expo-secure-store`.
     */
    const tokenStore = createMemoryTokenStore();
    const controller = createSessionController({
      tokenStore,
      localStore: createMemoryLocalStore(),
      refreshTokens: async (refreshToken) => {
        await parked;
        return anonymous.refresh({ refreshToken });
      },
    });

    /*
     * Signed in with a real session whose access token is genuinely expired - signed by
     * the server with a negative TTL, as in `API-19`, so the server answers
     * `token_expired` rather than `token_invalid`. The refresh token is the real one from
     * signup, which is what makes the rotation below a real single-use rotation.
     */
    const expired = await signAccessToken(auth.user.id, -60);
    await controller.signIn({ ...auth, accessToken: expired.token });
    expect(controller.getSnapshot()).toEqual({ status: 'authenticated', expired: false });

    const client = createApiClient({
      // The controller passed straight in as the `TokenSource`: it satisfies the
      // interface structurally, which is the whole of what `TVO-23` bought.
      transport: createAuthorizedTransport(transport, controller),
    });

    trips = [];
    const [me, categories] = await Promise.all([client.getMe(), client.listCategories()]);

    // Both requests resolved, for the right user - not one served and one logged out.
    // Two different endpoints on purpose: the retry is driven per request, so two calls
    // to the same route could hide a reply being replayed to the wrong caller.
    expect(me.user.id).toBe(auth.user.id);
    expect(categories.data).toHaveLength(DEFAULT_CATEGORIES.length);

    /*
     * Five trips, and the shape rather than the sequence because the two authorized
     * requests race by construction: two 401s, one refresh, two retries. The assertion
     * that carries the case is the middle one - a second `POST /v1/auth/refresh` is a
     * second rotation of a single-use token, which is the bug `inFlightRefresh` exists
     * to prevent and which no test has ever been able to rule out against a server that
     * really revokes.
     */
    expect(trips).toHaveLength(5);
    expect(trips.filter((trip) => trip.status === 401)).toHaveLength(2);
    expect(trips.filter((trip) => trip.url === '/v1/auth/refresh')).toEqual([
      { method: 'POST', url: '/v1/auth/refresh', status: 200 },
    ]);
    expect(trips.filter((trip) => trip.status === 200 && trip.url !== '/v1/auth/refresh')).toEqual([
      { method: 'GET', url: '/v1/me', status: 200 },
      { method: 'GET', url: '/v1/categories', status: 200 },
    ]);

    /*
     * And the proof that one refresh was not merely tidier but necessary. The session the
     * controller now holds is the rotated one, and the token it arrived with is revoked
     * server-side - so had the second 401 rotated as well, it would have presented this
     * dead token, taken `token_invalid`, and `UNRECOVERABLE_CODES` would have dropped the
     * session and sent the user to the login screen. Read back through the real endpoint,
     * which is the client's own view of it.
     */
    const stored = await tokenStore.read();
    expect(stored?.refreshToken).not.toBe(auth.refreshToken);
    expect(stored?.userId).toBe(auth.user.id);
    await expect(anonymous.refresh({ refreshToken: auth.refreshToken })).rejects.toMatchObject({
      status: 401,
      code: 'token_invalid',
    });

    // Still signed in, and never flagged `expired` - the banner on Welcome stayed down.
    expect(controller.getSnapshot()).toEqual({ status: 'authenticated', expired: false });
  });
});

/**
 * A round trip the server completed and the client never saw.
 *
 * `fetchImpl` performs the real request, waits for the real answer, drains it, and *then*
 * fails. That is exactly the shape of a dropped answer: the write is committed, the
 * socket is gone, and the client is left with a rejected promise and no way to know which
 * side of the commit it is on. On a device it arrives as the transport's own 15s
 * `AbortController` firing on a congested radio, as the OS reclaiming a backgrounded app
 * mid-request, or as a radio handover - all routine, none of them exotic.
 *
 * Modelled at the `fetch` boundary rather than by stubbing the client, so the server
 * genuinely did the work: every assertion about what the server now holds is read back
 * out of Postgres, not out of this fake.
 */
function droppingTransport(dropPath: string): Transport {
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    trips.push({
      method: init?.method ?? 'GET',
      url: String(input).slice(baseUrl.length),
      status: response.status,
    });
    if (String(input).includes(dropPath)) {
      await response.text();
      throw new Error('the connection dropped before the answer arrived');
    }
    return response;
  };
  return createTransport({ baseUrl, fetchImpl });
}

describe('API-25 — a refresh whose answer never arrives', () => {
  it('rotates server-side anyway, so the licensed retry is a logout', async () => {
    const anonymous = createApiClient({ transport: recordingTransport() });
    const auth = await anonymous.signup({
      email: uniqueEmail('lostrefresh'),
      password: TEST_PASSWORD,
    });

    const dropping = createApiClient({ transport: droppingTransport('/v1/auth/refresh') });
    trips = [];

    // Branch one of `01-flows.md` §3 rule 1: "a failed request, a timeout, or a DNS
    // failure leaves the session intact". The client cannot tell this from being offline,
    // and the contract gives it nothing to tell it with.
    await expect(dropping.refresh({ refreshToken: auth.refreshToken })).rejects.toBeInstanceOf(
      NetworkUnavailableError,
    );
    expect(trips).toEqual([{ method: 'POST', url: '/v1/auth/refresh', status: 200 }]);

    // The server answered 200 and committed. Read back out of Postgres rather than
    // inferred: the presented token is revoked, and the successor it minted is live.
    const rows = await getPrisma().refreshToken.findMany({ where: { userId: auth.user.id } });
    expect(rows).toHaveLength(2);
    const presented = rows.find((row) => row.tokenHash === hashRefreshToken(auth.refreshToken));
    expect(presented?.revokedAt).not.toBeNull();
    const successor = rows.filter((row) => row.revokedAt === null);
    expect(successor).toHaveLength(1);
    expect(successor[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Branch two, reached *because of* branch one. The stored token is the only one the
    // client has, so the retry rule 1 licenses presents an already-rotated token - and
    // `openapi.yaml` tells the client to read that as "session over, re-login".
    await expect(anonymous.refresh({ refreshToken: auth.refreshToken })).rejects.toMatchObject({
      status: 401,
      code: 'token_invalid',
    });

    // And the successor is now unreachable: a live 60-day credential for this account
    // that no client holds, and that nothing prunes before its expiry.
    const after = await getPrisma().refreshToken.findMany({
      where: { userId: auth.user.id, revokedAt: null },
    });
    expect(after.map((row) => row.id)).toEqual([successor[0]?.id]);
  });

  it('costs nothing on logout, which is the same lost answer one route over', async () => {
    const anonymous = createApiClient({ transport: recordingTransport() });
    const auth = await anonymous.signup({
      email: uniqueEmail('lostlogout'),
      password: TEST_PASSWORD,
    });

    const dropping = createApiClient({ transport: droppingTransport('/v1/auth/logout') });
    await expect(dropping.logout({ refreshToken: auth.refreshToken })).rejects.toBeInstanceOf(
      NetworkUnavailableError,
    );

    // Same shape, opposite outcome. `authService.logout` is "idempotent and deliberately
    // forgiving", so retrying a lost logout reaches the state the user asked for. The
    // asymmetry is the finding: one of the two routes that spend a refresh token was
    // written for a client that may have to ask twice, and the other was not.
    await expect(anonymous.logout({ refreshToken: auth.refreshToken })).resolves.toBeUndefined();
  });
});

describe('the account endpoints, through the real client against the real server', () => {
  it('changes the password: parses the returned pair, 403s a wrong one, and keeps the 403 off the session', async () => {
    const { auth, client, anonymous } = await signedIn();

    // A wrong current password is `403 forbidden` - and the client surfaces it as a normal
    // ApiRequestError rather than the session-ending 401 path.
    const wrong = await client
      .changePassword({ currentPassword: 'not-the-password', newPassword: 'staple-battery-horse' })
      .catch((error: unknown) => error);
    expect(wrong).toBeInstanceOf(ApiRequestError);
    expect((wrong as ApiRequestError).status).toBe(403);
    expect((wrong as ApiRequestError).code).toBe('forbidden');

    const pair = await client.changePassword({
      currentPassword: TEST_PASSWORD,
      newPassword: 'staple-battery-horse',
    });
    expect(pair.accessToken).toMatch(/\S/);
    expect(pair.refreshToken).not.toBe(auth.refreshToken);

    // The old refresh token died with the change; the returned one works.
    await expect(anonymous.refresh({ refreshToken: auth.refreshToken })).rejects.toMatchObject({
      code: 'token_invalid',
    });
    await expect(anonymous.refresh({ refreshToken: pair.refreshToken })).resolves.toBeDefined();
    await expect(
      anonymous.login({ email: auth.user.email, password: 'staple-battery-horse' }),
    ).resolves.toBeDefined();
  });

  it('deletes the account: resolves with no body, then the account is gone', async () => {
    const { auth, client, anonymous } = await signedIn();

    await expect(client.deleteAccount({ password: TEST_PASSWORD })).resolves.toBeUndefined();

    await expect(
      anonymous.login({ email: auth.user.email, password: TEST_PASSWORD }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(client.getMe()).rejects.toMatchObject({ code: 'token_invalid' });
  });
});

describe('API-27 — a household, driven by two real clients', () => {
  it('shares the owner books with a member, and gives them back on leaving', async () => {
    const owner = await signedIn();
    const member = await signedIn();

    const category = (await owner.client.listCategories()).data[0]!;
    const expense = (
      await owner.client.createExpense({
        categoryId: category.id,
        amountMinor: 1250,
        date: '2026-10-09',
      })
    ).data;

    // Nothing in a household yet: `null`, parsed by the strict client schema.
    expect((await owner.client.getHousehold()).household).toBeNull();

    const created = (await owner.client.createHousehold()).household;
    expect(created).toMatchObject({ role: 'owner', ownerId: owner.auth.user.id });

    const { code } = (await owner.client.createHouseholdInvite()).data;
    const joined = (await member.client.joinHousehold({ code })).household;
    expect(joined).toMatchObject({ role: 'member', ownerId: owner.auth.user.id });
    expect(joined?.members).toHaveLength(2);

    // The member's identity is unchanged; their data scope is the owner's.
    const me = await member.client.getMe();
    expect(me.user.id).toBe(member.auth.user.id);
    expect(me.dataOwnerId).toBe(owner.auth.user.id);
    const seen = (await member.client.listExpenses()).data.map((e: Expense) => e.id);
    expect(seen).toContain(expense.id);

    // 204s resolve to nothing, as the client promises.
    await expect(member.client.leaveHousehold()).resolves.toBeUndefined();
    expect((await member.client.getMe()).dataOwnerId).toBe(member.auth.user.id);
    expect((await member.client.listExpenses()).data.map((e: Expense) => e.id)).not.toContain(
      expense.id,
    );

    await expect(owner.client.deleteHousehold()).resolves.toBeUndefined();
    expect((await owner.client.getHousehold()).household).toBeNull();
  });

  it('carries the documented error codes to the client', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    await owner.client.createHousehold();

    await expect(other.client.joinHousehold({ code: 'AAAAAAAA' })).rejects.toMatchObject({
      code: 'invalid_invite_code',
    });
    await expect(other.client.leaveHousehold()).rejects.toMatchObject({ code: 'not_in_household' });
    await expect(owner.client.leaveHousehold()).rejects.toMatchObject({
      code: 'owner_cannot_leave',
    });
  });
});
