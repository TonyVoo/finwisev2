import { ApiError, AuthResponse, LIMITS } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { TEST_PASSWORD, api, uniqueEmail } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * §4 of `docs/qa/TEST_PLAN.md`, API layer: `AUTH-01` to `AUTH-07`.
 *
 * `AUTH-08` onward are E2E or Unit and live on the device or in `mobile/`. The seven
 * here overlap `auth.signup.test.ts`, `auth.login.test.ts`, `auth.refresh.test.ts` and
 * `auth.logout.test.ts`, deliberately: those suites were written against the endpoints
 * and these are written against the plan's own Expect clauses, which name things the
 * endpoint suites do not — `refreshTokenExpiresAt` being ~60 days out, `X-Request-Id` on
 * the signup response, both password bounds, and byte-identical login failures.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe('AUTH-01 — sign up creates an account and a usable session', () => {
  it('returns a full AuthResponse whose access token works immediately', async () => {
    const email = uniqueEmail();
    const before = Date.now();

    const signup = await api()
      .post('/v1/auth/signup')
      .send({ email, password: TEST_PASSWORD, currency: 'USD' });

    expect(signup.status).toBe(201);
    expect(() => AuthResponse.parse(signup.body)).not.toThrow();

    const body = signup.body as AuthResponse;
    expect(body.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.user.email).toBe(email);
    expect(body.user.currency).toBe('USD');
    expect(body.accessTokenExpiresIn).toBe(3600);

    // ~60 days out. A short refresh lifetime is what logs an offline-first user out
    // after a week away, so the number is asserted rather than the field's presence.
    const expiresInDays = (Date.parse(body.refreshTokenExpiresAt) - before) / DAY_MS;
    expect(expiresInDays).toBeGreaterThan(59);
    expect(expiresInDays).toBeLessThan(61);

    expect(signup.headers['x-request-id']).toMatch(/\S/);

    const me = await api().get('/v1/me').set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(body.user.id);
  });
});

describe('AUTH-02 — email is normalised, so case and whitespace do not create a second account', () => {
  it('refuses the padded, upper-cased duplicate and logs the original in', async () => {
    const user = await createUser();

    const second = await api()
      .post('/v1/auth/signup')
      .send({ email: `  ${user.user.email.toUpperCase()}  `, password: TEST_PASSWORD });
    expect(second.status).toBe(409);
    expect((second.body as ApiError).error.code).toBe('email_already_exists');

    const login = await api()
      .post('/v1/auth/login')
      .send({ email: user.user.email.toUpperCase(), password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(user.user.id);
  });
});

describe('AUTH-03 — signup defaults currency to USD when omitted', () => {
  it('is 201 with USD and no currency key sent', async () => {
    const response = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });

    expect(response.status).toBe(201);
    expect(response.body.user.currency).toBe('USD');
  });
});

describe('AUTH-04 — password length is enforced at both bounds', () => {
  it('is inclusive at PASSWORD_MIN and PASSWORD_MAX and rejects either side', async () => {
    const attempt = (length: number) =>
      api()
        .post('/v1/auth/signup')
        .send({ email: uniqueEmail(), password: 'a'.repeat(length) });

    for (const length of [LIMITS.PASSWORD_MIN - 1, LIMITS.PASSWORD_MAX + 1]) {
      const response = await attempt(length);
      expect(response.status, `length ${length}`).toBe(400);
      const error = (response.body as ApiError).error;
      expect(error.code).toBe('validation_error');
      // The field has to be identifiable or the form cannot show the message under the
      // right input. `password` reaches the client through `path` here, unlike the
      // unknown-key case in `API-03`, because a length failure carries a real path.
      expect(
        (error.details?.issues ?? []).some((issue) => issue.path.includes('password')),
      ).toBe(true);
    }

    for (const length of [LIMITS.PASSWORD_MIN, LIMITS.PASSWORD_MAX]) {
      expect((await attempt(length)).status, `length ${length}`).toBe(201);
    }
  });
});

describe('AUTH-05 — login does not reveal which half of the credential was wrong', () => {
  it('answers a wrong password and an unknown email byte-identically', async () => {
    const user = await createUser();

    const wrongPassword = await api()
      .post('/v1/auth/login')
      .send({ email: user.user.email, password: 'definitely-not-the-password' });
    const unknownEmail = await api()
      .post('/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: TEST_PASSWORD });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect((response.body as ApiError).error.code).toBe('invalid_credentials');
    }

    // Byte-identical bodies, and no header differs but the request id.
    expect(JSON.stringify(wrongPassword.body)).toBe(JSON.stringify(unknownEmail.body));

    const comparable = (headers: Record<string, string | undefined>) => {
      const { 'x-request-id': _id, date: _date, etag: _etag, ...rest } = headers;
      return rest;
    };
    expect(comparable(wrongPassword.headers)).toEqual(comparable(unknownEmail.headers));
  });
});

describe('AUTH-06 — refresh rotates the pair and single-uses the old token', () => {
  it('spends R1, keeps R2 usable, and does not revoke the chain', async () => {
    const user = await createUser();
    const r1 = user.refreshToken;

    const first = await api().post('/v1/auth/refresh').send({ refreshToken: r1 });
    expect(first.status).toBe(200);
    const r2 = first.body.refreshToken as string;
    expect(r2).not.toBe(r1);

    const replay = await api().post('/v1/auth/refresh').send({ refreshToken: r1 });
    expect(replay.status).toBe(401);
    expect((replay.body as ApiError).error.code).toBe('token_invalid');

    // Step 3 is the one that matters: rejecting the replay must not have revoked R2.
    const third = await api().post('/v1/auth/refresh').send({ refreshToken: r2 });
    expect(third.status).toBe(200);
    expect(third.body.refreshToken).not.toBe(r2);
  });
});

describe('AUTH-07 — logout is idempotent and forgiving', () => {
  it('is 204 for a spent token and an unissued one, and 400 only for a malformed body', async () => {
    const user = await createUser();
    const r1 = user.refreshToken;

    for (const body of [{ refreshToken: r1 }, { refreshToken: r1 }, { refreshToken: 'v1.never-issued' }]) {
      const response = await api().post('/v1/auth/logout').send(body);
      expect(response.status).toBe(204);
      expect(response.body).toEqual({});
      expect(response.text).toBe('');
    }

    const refresh = await api().post('/v1/auth/refresh').send({ refreshToken: r1 });
    expect(refresh.status).toBe(401);
    expect((refresh.body as ApiError).error.code).toBe('token_invalid');

    const empty = await api().post('/v1/auth/logout').send({});
    expect(empty.status).toBe(400);
    expect((empty.body as ApiError).error.code).toBe('validation_error');
  });
});
