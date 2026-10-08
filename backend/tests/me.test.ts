import { MeResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/accessToken.ts';
import { getPrisma } from '../src/db/client.ts';
import { api, bearer, signUp } from './support/api.ts';

describe('GET /v1/me', () => {
  it('returns the user the token belongs to', async () => {
    const account = await signUp();

    const response = await api().get('/v1/me').set('Authorization', bearer(account.accessToken));

    expect(response.status).toBe(200);
    expect(() => MeResponse.parse(response.body)).not.toThrow();
    expect(response.body.user).toEqual(account.user);
  });

  it('never exposes the password hash', async () => {
    const account = await signUp();

    const response = await api().get('/v1/me').set('Authorization', bearer(account.accessToken));

    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('argon2');
  });

  it('returns the token holder, never another user, when two accounts exist', async () => {
    const first = await signUp();
    const second = await signUp();

    const response = await api().get('/v1/me').set('Authorization', bearer(second.accessToken));

    expect(response.body.user.id).toBe(second.user.id);
    expect(response.body.user.id).not.toBe(first.user.id);
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await api().get('/v1/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it.each([
    ['a non-Bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer value', 'Bearer '],
    ['the token with no scheme', 'eyJhbGciOiJIUzI1NiJ9.e30.sig'],
  ])('rejects %s as unauthorized', async (_label, header) => {
    const response = await api().get('/v1/me').set('Authorization', header);

    // No usable credentials presented at all is `unauthorized`; credentials that do not
    // hold up are `token_invalid`. The client branches on exactly that difference.
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it.each([
    ['a structurally broken token', 'not-a-jwt'],
    ['a token with a tampered signature', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.wrong-signature'],
  ])('rejects %s as token_invalid', async (_label, token) => {
    const response = await api().get('/v1/me').set('Authorization', bearer(token));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('reports an expired token as token_expired so the client knows to refresh', async () => {
    const account = await signUp();
    // Minted with a negative TTL: already expired at the moment it is signed, which is
    // the only way to test this branch without waiting an hour.
    const expired = await signAccessToken(account.user.id, -60);

    const response = await api().get('/v1/me').set('Authorization', bearer(expired.token));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_expired');
  });

  it('rejects a token whose user no longer exists', async () => {
    const account = await signUp();
    await getPrisma().user.delete({ where: { id: account.user.id } });

    const response = await api().get('/v1/me').set('Authorization', bearer(account.accessToken));

    // `token_invalid` and not 404: the client's correct response is to re-login, not to
    // retry the request.
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('token_invalid');
  });

  it('accepts a lowercase bearer scheme', async () => {
    const account = await signUp();

    const response = await api()
      .get('/v1/me')
      .set('Authorization', `bearer ${account.accessToken}`);

    expect(response.status).toBe(200);
  });
});
