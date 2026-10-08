import { AuthResponse, DEFAULT_CATEGORIES, UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { TEST_PASSWORD, api, uniqueEmail } from './support/api.ts';

describe('POST /v1/auth/signup', () => {
  it('creates an account and returns a usable session', async () => {
    const email = uniqueEmail();
    const response = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    expect(response.status).toBe(201);
    expect(() => AuthResponse.parse(response.body)).not.toThrow();

    const body = response.body as AuthResponse;
    expect(body.user.email).toBe(email);
    expect(body.user.currency).toBe('USD');
    expect(body.accessTokenExpiresIn).toBe(3600);

    // The session must work immediately — a signup that needs a follow-up login is a
    // broken first-run experience.
    const me = await api().get('/v1/me').set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(body.user.id);
  });

  it('never returns the password or its hash', async () => {
    const response = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });

    expect(JSON.stringify(response.body)).not.toContain('argon2');
    expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('hashes the password with argon2id rather than storing it', async () => {
    const email = uniqueEmail();
    await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    const row = await getPrisma().user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('seeds the default categories, including Uncategorized', async () => {
    const email = uniqueEmail();
    const response = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    const categories = await getPrisma().category.findMany({
      where: { userId: response.body.user.id },
      orderBy: { revision: 'asc' },
    });

    expect(categories.map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.map((c) => c.name));

    const defaults = categories.filter((c) => c.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe(UNCATEGORIZED_NAME);
  });

  it('stamps the seeded categories with a gap-free revision sequence starting at 1', async () => {
    const response = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });

    const categories = await getPrisma().category.findMany({
      where: { userId: response.body.user.id },
      orderBy: { revision: 'asc' },
    });

    // The sync cursor is a revision watermark, so a gap here is a row no client would
    // ever be delivered.
    expect(categories.map((c) => c.revision)).toEqual(
      Array.from({ length: DEFAULT_CATEGORIES.length }, (_, i) => i + 1),
    );
  });

  it('gives each user their own revision sequence', async () => {
    const first = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });
    const second = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });

    const revisionsOf = async (userId: string): Promise<number[]> =>
      (
        await getPrisma().category.findMany({ where: { userId }, orderBy: { revision: 'asc' } })
      ).map((c) => c.revision);

    // Per-user, not global: the second signup must start at 1 again, or the first
    // client's cursor would skip straight past its own rows.
    expect(await revisionsOf(second.body.user.id)).toEqual(await revisionsOf(first.body.user.id));
    expect(await revisionsOf(second.body.user.id)).toContain(1);
  });

  it('stores the email lowercased', async () => {
    const email = uniqueEmail().toUpperCase();
    const response = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(email.toLowerCase());
  });

  it('rejects a duplicate email', async () => {
    const email = uniqueEmail();
    await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    const second = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('email_already_exists');
  });

  it('treats A@x.com and a@x.com as the same account', async () => {
    const email = uniqueEmail();
    await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    const second = await api()
      .post('/v1/auth/signup')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('email_already_exists');
  });

  it('accepts an explicit currency', async () => {
    const response = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, currency: 'EUR' });

    expect(response.status).toBe(201);
    expect(response.body.user.currency).toBe('EUR');
  });

  it.each([
    ['a malformed email', { email: 'not-an-email', password: TEST_PASSWORD }],
    ['a password under the minimum', { email: 'short@example.com', password: 'abc' }],
    ['a missing password', { email: 'nopass@example.com' }],
    [
      'a lowercase currency',
      { email: 'cur@example.com', password: TEST_PASSWORD, currency: 'usd' },
    ],
  ])('rejects %s', async (_label, body) => {
    const response = await api().post('/v1/auth/signup').send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    // A typo'd or hopeful extra key (`isAdmin`, `userId`) must fail loudly. Silently
    // dropping it is how a client ends up believing it set something it did not.
    const response = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, isAdmin: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('rejects a body that is not JSON', async () => {
    const response = await api()
      .post('/v1/auth/signup')
      .set('Content-Type', 'text/plain')
      .send('email=sam@example.com');

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('unsupported_media_type');
  });

  it('rejects unparseable JSON', async () => {
    const response = await api()
      .post('/v1/auth/signup')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('malformed_request');
  });

  it('rejects an absent body', async () => {
    const response = await api().post('/v1/auth/signup');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('malformed_request');
  });
});
