import { API_ROUTES, type RouteSpec } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api, bearer, signUp } from './support/api.ts';

/**
 * Tenancy is structural, not per-handler.
 *
 * `docs/PLAN.md` §3 says every query is scoped by the `userId` from the token and no
 * endpoint accepts a `userId` from the client. These tests check that from the outside,
 * driven by the route table in `shared/` rather than a hand-written list — so a route
 * added in a later task is covered the moment it appears in the contract, instead of
 * when someone remembers to add it here.
 */

const AUTHED_ROUTES: readonly RouteSpec[] = API_ROUTES.filter((route) => route.auth);
const PUBLIC_ROUTES: readonly RouteSpec[] = API_ROUTES.filter((route) => !route.auth);

/** Fill an OpenAPI path template with a syntactically valid id. */
function concretePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '0192f3a0-7c3a-7f1e-9b2d-1c4a5e6f7a80');
}

function request(route: RouteSpec) {
  const agent = api();
  const path = concretePath(route.path);
  switch (route.method) {
    case 'get':
      return agent.get(path);
    case 'post':
      return agent.post(path);
    case 'put':
      return agent.put(path);
    case 'patch':
      return agent.patch(path);
    case 'delete':
      return agent.delete(path);
  }
}

describe('every authenticated route requires a token', () => {
  it('has authenticated routes to check', () => {
    // Guards against the loops below silently passing on an empty list.
    expect(AUTHED_ROUTES.length).toBeGreaterThan(0);
  });

  it.each(AUTHED_ROUTES.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route]))(
    '%s is 401 without credentials',
    async (_label, route) => {
      const response = await request(route);

      // 401 rather than 404 even for routes not yet implemented: `requireAuth` is
      // mounted on the `/v1` router, so a data route added later is authenticated by
      // default. The failure mode of a per-handler list is that one handler is missing
      // from it, and that handler serves every user's rows to anyone.
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('unauthorized');
    },
  );

  it.each(AUTHED_ROUTES.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route]))(
    '%s is 401 with a token that does not verify',
    async (_label, route) => {
      const response = await request(route).set('Authorization', bearer('forged.token.value'));

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('token_invalid');
    },
  );

  it('never returns a 2xx to an unauthenticated request on an authenticated route', async () => {
    const statuses = await Promise.all(
      AUTHED_ROUTES.map(async (route) => (await request(route)).status),
    );

    expect(statuses.every((status) => status < 200 || status >= 300)).toBe(true);
  });
});

describe('public routes stay reachable without a token', () => {
  it.each(PUBLIC_ROUTES.map((route) => [`${route.method.toUpperCase()} ${route.path}`, route]))(
    '%s is not an auth failure',
    async (_label, route) => {
      const response = await request(route);

      // These answer 400 (no body) or 200; what matters is that none of them demands a
      // token, because a client with an expired session has to be able to log in again.
      expect(response.status).not.toBe(401);
    },
  );
});

describe('no endpoint accepts a client-supplied userId', () => {
  it('rejects a userId smuggled into a request body', async () => {
    const victim = await signUp();

    const response = await api()
      .post('/v1/auth/login')
      .send({ email: victim.user.email, password: victim.password, userId: victim.user.id });

    // The request schemas in `shared/` are strict objects, so this is a 400 rather than
    // a field that happens to be ignored today and honoured after a refactor.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('declares no userId field anywhere in the request contract', () => {
    // The structural version of the rule: if `userId` is not in the wire contract, no
    // handler can read one.
    const contract = JSON.stringify(API_ROUTES);
    expect(contract).not.toContain('userId');
  });

  it('serves each token holder only their own user', async () => {
    const first = await signUp();
    const second = await signUp();

    const [a, b] = await Promise.all([
      api().get('/v1/me').set('Authorization', bearer(first.accessToken)),
      api().get('/v1/me').set('Authorization', bearer(second.accessToken)),
    ]);

    expect(a.body.user.id).toBe(first.user.id);
    expect(b.body.user.id).toBe(second.user.id);
  });
});
