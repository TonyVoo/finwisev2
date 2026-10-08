import { describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../src/auth/refreshToken.ts';
import { getPrisma } from '../src/db/client.ts';
import { api, signUp } from './support/api.ts';

describe('POST /v1/auth/logout', () => {
  it('revokes the token and answers 204 with no body', async () => {
    const account = await signUp();

    const response = await api()
      .post('/v1/auth/logout')
      .send({ refreshToken: account.refreshToken });

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    const row = await getPrisma().refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(account.refreshToken) },
    });
    expect(row.revokedAt).not.toBeNull();
  });

  it('makes the token unusable for refresh afterwards', async () => {
    const account = await signUp();
    await api().post('/v1/auth/logout').send({ refreshToken: account.refreshToken });

    const response = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('is idempotent', async () => {
    const account = await signUp();

    const first = await api().post('/v1/auth/logout').send({ refreshToken: account.refreshToken });
    const second = await api().post('/v1/auth/logout').send({ refreshToken: account.refreshToken });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });

  it('succeeds for an unknown token', async () => {
    // The client's goal is "this session is over so I can clear local credentials".
    // Failing that would leave the app stuck half-logged-out with no way forward.
    const response = await api()
      .post('/v1/auth/logout')
      .send({ refreshToken: 'v1.never-issued-this-one' });

    expect(response.status).toBe(204);
  });

  it('leaves the user’s other sessions alone', async () => {
    const account = await signUp();
    const otherDevice = await api()
      .post('/v1/auth/login')
      .send({ email: account.user.email, password: account.password });

    await api().post('/v1/auth/logout').send({ refreshToken: account.refreshToken });

    // Logging out of one device must not log out the others.
    const refreshed = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: otherDevice.body.refreshToken });

    expect(refreshed.status).toBe(200);
  });

  it('needs no access token', async () => {
    const account = await signUp();

    // Per the contract, logout is unauthenticated: an expired access token must not
    // stop a client from ending its session.
    const response = await api()
      .post('/v1/auth/logout')
      .send({ refreshToken: account.refreshToken });

    expect(response.status).toBe(204);
  });

  it('rejects a malformed body', async () => {
    const response = await api().post('/v1/auth/logout').send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});
