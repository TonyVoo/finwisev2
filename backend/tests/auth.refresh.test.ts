import { RefreshResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { hashRefreshToken } from '../src/auth/refreshToken.ts';
import { getPrisma } from '../src/db/client.ts';
import { api, bearer, signUp } from './support/api.ts';

describe('POST /v1/auth/refresh', () => {
  it('rotates the pair and returns a working access token', async () => {
    const account = await signUp();

    const response = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });

    expect(response.status).toBe(200);
    expect(() => RefreshResponse.parse(response.body)).not.toThrow();
    expect(response.body.refreshToken).not.toBe(account.refreshToken);

    const me = await api().get('/v1/me').set('Authorization', bearer(response.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(account.user.id);
  });

  it('rejects the presented token once it has been rotated', async () => {
    const account = await signUp();

    const first = await api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken });
    expect(first.status).toBe(200);

    const replay = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });

    // Single-use is the whole point: a refresh token that still works after rotation is
    // a stolen token that works forever.
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('token_invalid');
  });

  it('keeps the new token usable after the old one is rejected', async () => {
    const account = await signUp();

    const rotated = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });
    await api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken });

    // Reuse-detection must not take the legitimate session down with it, or a dropped
    // response on the client's side would log the user out.
    const again = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });

    expect(again.status).toBe(200);
  });

  it('can be rotated repeatedly', async () => {
    const account = await signUp();
    let token = account.refreshToken;

    for (let i = 0; i < 3; i += 1) {
      const response = await api().post('/v1/auth/refresh').send({ refreshToken: token });
      expect(response.status).toBe(200);
      expect(response.body.refreshToken).not.toBe(token);
      token = response.body.refreshToken;
    }
  });

  it('stores only a hash of the token, never the token itself', async () => {
    const account = await signUp();

    const rows = await getPrisma().refreshToken.findMany({ where: { userId: account.user.id } });

    // A database dump must not be replayable as a session.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(account.refreshToken);
    expect(rows[0]?.tokenHash).toBe(hashRefreshToken(account.refreshToken));
  });

  it('marks the rotated token revoked rather than deleting it', async () => {
    const account = await signUp();
    await api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken });

    const original = await getPrisma().refreshToken.findUniqueOrThrow({
      where: { tokenHash: hashRefreshToken(account.refreshToken) },
    });

    // Keeping the row is what makes a replay detectable; deleting it would make a
    // stolen-token replay indistinguishable from a typo.
    expect(original.revokedAt).not.toBeNull();
  });

  it('rejects an unknown token', async () => {
    const response = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'v1.this-token-was-never-issued' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('reports an expired token as token_expired, not token_invalid', async () => {
    const account = await signUp();

    await getPrisma().refreshToken.update({
      where: { tokenHash: hashRefreshToken(account.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_expired');
  });

  it('reports a reused token as token_invalid even once it has also expired', async () => {
    const account = await signUp();
    await api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken });

    await getPrisma().refreshToken.update({
      where: { tokenHash: hashRefreshToken(account.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken });

    // Order matters: `token_expired` tells the client the token might work again after
    // a retry, which a revoked token never will.
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('issues exactly one new session when the same token is refreshed concurrently', async () => {
    const account = await signUp();

    const results = await Promise.all([
      api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }),
      api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }),
    ]);

    // Two concurrent refreshes with the same token must produce one session and one
    // rejection. Two sessions would mean the conditional claim is not actually atomic.
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it.each([
    ['a missing token', {}],
    ['an empty token', { refreshToken: '' }],
    ['an unknown field', { refreshToken: 'v1.abc', accessToken: 'also-this' }],
  ])('rejects %s with validation_error', async (_label, body) => {
    const response = await api().post('/v1/auth/refresh').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});
