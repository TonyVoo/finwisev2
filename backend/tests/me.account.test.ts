import { LIMITS, TokenPair } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { TEST_PASSWORD, api, bearer } from './support/api.ts';
import { createExpense, createUser } from './support/fixtures.ts';
import { push, pushItem } from './support/sync.ts';

/**
 * `POST /v1/me/password` and `DELETE /v1/me`: the two endpoints that ask a signed-in user
 * to re-enter their password.
 */

const NEW_PASSWORD = 'staple-battery-horse';

function changePassword(auth: string, body: unknown) {
  return api()
    .post('/v1/me/password')
    .set('Authorization', auth)
    .send(body as object);
}

function deleteAccount(auth: string, body: unknown) {
  return api()
    .delete('/v1/me')
    .set('Authorization', auth)
    .send(body as object);
}

function login(email: string, password: string) {
  return api().post('/v1/auth/login').send({ email, password });
}

describe('POST /v1/me/password', () => {
  it('changes the password: the new one logs in, the old one does not', async () => {
    const user = await createUser();

    const response = await changePassword(user.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(() => TokenPair.parse(response.body)).not.toThrow();
    expect((await login(user.user.email, NEW_PASSWORD)).status).toBe(200);
    const old = await login(user.user.email, TEST_PASSWORD);
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('invalid_credentials');
  });

  it('ends every other session but keeps the calling device signed in', async () => {
    const user = await createUser();
    // A second device: another login against the same account.
    const other = await login(user.user.email, TEST_PASSWORD);
    expect(other.status).toBe(200);

    const response = await changePassword(user.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    const fresh = response.body as TokenPair;

    // The signup session, the other device's session: both revoked.
    for (const refreshToken of [user.refreshToken, other.body.refreshToken as string]) {
      const refreshed = await api().post('/v1/auth/refresh').send({ refreshToken });
      expect(refreshed.status).toBe(401);
      expect(refreshed.body.error.code).toBe('token_invalid');
    }
    // The pair this call returned works.
    const rotated = await api().post('/v1/auth/refresh').send({ refreshToken: fresh.refreshToken });
    expect(rotated.status).toBe(200);
    expect((await api().get('/v1/me').set('Authorization', bearer(fresh.accessToken))).status).toBe(
      200,
    );
  });

  it('is 403 forbidden - not 401 - for a wrong current password, and changes nothing', async () => {
    const user = await createUser();

    const response = await changePassword(user.auth, {
      currentPassword: 'definitely-not-it',
      newPassword: NEW_PASSWORD,
    });

    // 401 would tell the client its session is dead and sign the user out.
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
    expect((await login(user.user.email, TEST_PASSWORD)).status).toBe(200);
    expect((await login(user.user.email, NEW_PASSWORD)).status).toBe(401);
    // And the session survived.
    expect((await api().get('/v1/me').set('Authorization', user.auth)).status).toBe(200);
  });

  it('rejects a new password that is too short, or the same as the current one', async () => {
    const user = await createUser();

    const short = await changePassword(user.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: 'short',
    });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('validation_error');

    const same = await changePassword(user.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
    });
    expect(same.status).toBe(400);
    expect(same.body.error.details.issues[0].path).toBe('newPassword');
  });

  it('rejects unknown fields and a missing body', async () => {
    const user = await createUser();
    const extra = await changePassword(user.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
      userId: 'someone-else',
    });
    expect(extra.status).toBe(400);

    const none = await api().post('/v1/me/password').set('Authorization', user.auth);
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('malformed_request');
  });

  it('requires a token', async () => {
    const response = await api()
      .post('/v1/me/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(401);
  });

  it('stores a hash, never the password', async () => {
    const user = await createUser();
    await changePassword(user.auth, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });

    const row = await getPrisma().user.findUniqueOrThrow({ where: { id: user.user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(NEW_PASSWORD);
  });

  it('throttles wrong answers per account, with Retry-After, and a right one clears the count', async () => {
    const user = await createUser();
    const budget = LIMITS.PASSWORD_CONFIRM_MAX_FAILURES_PER_USER;

    // One short of the limit, then a correct answer: the count resets.
    for (let i = 0; i < budget - 1; i += 1) {
      const wrong = await changePassword(user.auth, {
        currentPassword: `wrong-password-${i}`,
        newPassword: NEW_PASSWORD,
      });
      expect(wrong.status).toBe(403);
    }
    const ok = await changePassword(user.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(ok.status).toBe(200);
    const auth = bearer((ok.body as TokenPair).accessToken);

    // A full budget of failures now trips the limit...
    for (let i = 0; i < budget; i += 1) {
      const wrong = await changePassword(auth, {
        currentPassword: `wrong-password-${i}`,
        newPassword: TEST_PASSWORD,
      });
      expect(wrong.status).toBe(403);
    }
    const limited = await changePassword(auth, {
      currentPassword: NEW_PASSWORD,
      newPassword: TEST_PASSWORD,
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // ...and the delete endpoint shares the same budget: guessing through one leaves no
    // fresh allowance on the other, even for the correct password.
    const shared = await deleteAccount(auth, { password: NEW_PASSWORD });
    expect(shared.status).toBe(429);
    expect((await api().get('/v1/me').set('Authorization', auth)).status).toBe(200);
  });

  it("does not throttle one account because of another's failures", async () => {
    const victim = await createUser();
    const bystander = await createUser();
    for (let i = 0; i < LIMITS.PASSWORD_CONFIRM_MAX_FAILURES_PER_USER; i += 1) {
      await changePassword(victim.auth, {
        currentPassword: `nope-${i}-xxxx`,
        newPassword: NEW_PASSWORD,
      });
    }
    const response = await changePassword(bystander.auth, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(200);
  });
});

describe('DELETE /v1/me', () => {
  it('deletes the account and everything it owns, leaving other accounts untouched', async () => {
    const doomed = await createUser();
    const survivor = await createUser();
    await createExpense(doomed, { categoryId: doomed.defaultCategory.id });
    await createExpense(doomed, {
      categoryId: doomed.categories['Groceries']?.id ?? doomed.defaultCategory.id,
    });
    await createExpense(survivor, { categoryId: survivor.defaultCategory.id });
    await push(doomed, [
      pushItem({
        entity: 'category',
        id: '0192f3a0-7c3a-7f1e-9b2d-1c4a5e6f7a81',
        fields: { name: 'Pets', color: '#22C55E' },
      }),
    ]);

    const response = await deleteAccount(doomed.auth, { password: TEST_PASSWORD });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    const prisma = getPrisma();
    const owned = { where: { userId: doomed.user.id } };
    expect(await prisma.user.count({ where: { id: doomed.user.id } })).toBe(0);
    expect(await prisma.expense.count(owned)).toBe(0);
    expect(await prisma.category.count(owned)).toBe(0);
    expect(await prisma.refreshToken.count(owned)).toBe(0);
    expect(await prisma.syncMutation.count(owned)).toBe(0);
    expect(await prisma.revisionCounter.count(owned)).toBe(0);

    // The other account is exactly as it was.
    expect(await prisma.expense.count({ where: { userId: survivor.user.id } })).toBe(1);
    expect(await prisma.category.count({ where: { userId: survivor.user.id } })).toBeGreaterThan(0);
    expect((await api().get('/v1/me').set('Authorization', survivor.auth)).status).toBe(200);
  });

  it('deletes soft-deleted rows too: nothing of the account survives as a tombstone', async () => {
    const user = await createUser();
    const expense = await createExpense(user, { categoryId: user.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set('Authorization', user.auth);

    expect((await deleteAccount(user.auth, { password: TEST_PASSWORD })).status).toBe(204);
    expect(await getPrisma().expense.count({ where: { userId: user.user.id } })).toBe(0);
  });

  it('frees the email, the login and the refresh token immediately', async () => {
    const user = await createUser();
    await deleteAccount(user.auth, { password: TEST_PASSWORD });

    const loginAfter = await login(user.user.email, TEST_PASSWORD);
    expect(loginAfter.status).toBe(401);
    expect(loginAfter.body.error.code).toBe('invalid_credentials');

    const refreshed = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: user.refreshToken });
    expect(refreshed.status).toBe(401);

    // And the address can register again, as a brand new account.
    const again = await api()
      .post('/v1/auth/signup')
      .send({ email: user.user.email, password: TEST_PASSWORD });
    expect(again.status).toBe(201);
    expect(again.body.user.id).not.toBe(user.user.id);
  });

  it('a surviving access token reads as token_invalid, not as someone else', async () => {
    const user = await createUser();
    await deleteAccount(user.auth, { password: TEST_PASSWORD });

    const me = await api().get('/v1/me').set('Authorization', user.auth);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('token_invalid');
  });

  it('is 403 forbidden for a wrong password and deletes nothing', async () => {
    const user = await createUser();
    await createExpense(user, { categoryId: user.defaultCategory.id });

    const response = await deleteAccount(user.auth, { password: 'not-the-password' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
    expect(await getPrisma().user.count({ where: { id: user.user.id } })).toBe(1);
    expect(await getPrisma().expense.count({ where: { userId: user.user.id } })).toBe(1);
  });

  it('needs a password in the body, and a token', async () => {
    const user = await createUser();
    expect((await api().delete('/v1/me').set('Authorization', user.auth)).status).toBe(400);
    expect((await deleteAccount(user.auth, {})).status).toBe(400);
    expect((await deleteAccount(user.auth, { password: '' })).status).toBe(400);
    expect((await api().delete('/v1/me').send({ password: TEST_PASSWORD })).status).toBe(401);
    expect(await getPrisma().user.count({ where: { id: user.user.id } })).toBe(1);
  });

  it('cannot be pointed at another account', async () => {
    const attacker = await createUser();
    const target = await createUser({});
    // The body carries no user id, and an unknown key is refused rather than ignored.
    const response = await deleteAccount(attacker.auth, {
      password: TEST_PASSWORD,
      userId: target.user.id,
    });
    expect(response.status).toBe(400);
    expect(await getPrisma().user.count({ where: { id: target.user.id } })).toBe(1);
  });

  it('is idempotent in effect: a second delete with the same token is refused, not a 500', async () => {
    const user = await createUser();
    expect((await deleteAccount(user.auth, { password: TEST_PASSWORD })).status).toBe(204);

    const again = await deleteAccount(user.auth, { password: TEST_PASSWORD });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('token_invalid');
  });

  it('with a stale access token, every route answers token_invalid - never a 500 - and nothing is resurrected', async () => {
    const user = await createUser();
    await deleteAccount(user.auth, { password: TEST_PASSWORD });

    const outcome = await push(user, [
      pushItem({
        entity: 'category',
        id: '0192f3a0-7c3a-7f1e-9b2d-1c4a5e6f7a82',
        fields: { name: 'Ghost', color: '#22C55E' },
      }),
    ]);
    expect(outcome.status).toBe(401);
    expect(outcome.error?.code).toBe('token_invalid');

    const pull = await api().get('/v1/sync?since=0').set('Authorization', user.auth);
    expect(pull.status).toBe(401);
    const create = await api()
      .post('/v1/expenses')
      .set('Authorization', user.auth)
      .send({ categoryId: user.defaultCategory.id, amountMinor: 100, date: '2026-10-06' });
    expect(create.status).toBe(401);

    expect(await getPrisma().user.count({ where: { id: user.user.id } })).toBe(0);
    expect(await getPrisma().category.count({ where: { userId: user.user.id } })).toBe(0);
  });
});
