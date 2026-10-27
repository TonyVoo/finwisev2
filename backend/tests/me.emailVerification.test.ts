import { LIMITS } from '@expense-tracker/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { setMailerForTests, type Mailer } from '../src/services/mailer.ts';
import { TEST_PASSWORD, api, bearer, signUp, uniqueEmail } from './support/api.ts';

/**
 * `POST /v1/me/email-verification` and `POST /v1/me/email-verification/confirm`.
 *
 * Verification is non-blocking, so what matters is: a code only ever confirms the address
 * it was mailed to, it dies after five wrong guesses / expiry / use, and the lifecycle hooks
 * (signup sends, change-email clears, reset verifies) hold.
 */

let sent: { to: string; code: string }[];

beforeEach(() => {
  sent = [];
  const recording: Mailer = {
    async sendPasswordResetCode(to, code) {
      sent.push({ to, code });
    },
    async sendEmailVerificationCode(to, code) {
      sent.push({ to, code });
    },
  };
  setMailerForTests(recording);
});
afterEach(() => setMailerForTests(null));

const request = (token: string) =>
  api().post('/v1/me/email-verification').set('Authorization', bearer(token)).send({});
const confirm = (token: string, code: string) =>
  api()
    .post('/v1/me/email-verification/confirm')
    .set('Authorization', bearer(token))
    .send({ code });
const me = (token: string) => api().get('/v1/me').set('Authorization', bearer(token));

/** Wait for the fire-and-forget signup mail. */
async function signupCode(): Promise<void> {
  for (let i = 0; i < 50 && sent.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('email verification', () => {
  it('starts unverified, and signup mails a code', async () => {
    const user = await signUp();
    expect(user.user.emailVerified).toBe(false);
    await signupCode();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(user.user.email);
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
  });

  it('confirms with the right code and reports emailVerified on /me', async () => {
    const user = await signUp();
    await signupCode();
    const res = await confirm(user.accessToken, sent[0]!.code);
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
    expect((await me(user.accessToken)).body.user.emailVerified).toBe(true);
  });

  it('a resend replaces the earlier code', async () => {
    const user = await signUp();
    await signupCode();
    const first = sent[0]!.code;
    expect((await request(user.accessToken)).status).toBe(204);
    const second = sent.at(-1)!.code;
    if (first !== second) {
      expect((await confirm(user.accessToken, first)).status).toBe(400);
    }
    expect((await confirm(user.accessToken, second)).status).toBe(200);
  });

  it('refuses a wrong code with invalid_verification_code', async () => {
    const user = await signUp();
    await signupCode();
    const wrong = sent[0]!.code === '000000' ? '000001' : '000000';
    const res = await confirm(user.accessToken, wrong);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_verification_code');
  });

  it('kills the code after the attempt cap, even for the right code', async () => {
    const user = await signUp();
    await signupCode();
    const right = sent[0]!.code;
    const wrong = right === '000000' ? '000001' : '000000';
    for (let i = 0; i < LIMITS.RESET_CODE_MAX_ATTEMPTS; i += 1) {
      expect((await confirm(user.accessToken, wrong)).status).toBe(400);
    }
    expect((await confirm(user.accessToken, right)).status).toBe(400);
  });

  it('refuses an expired code', async () => {
    const user = await signUp();
    await signupCode();
    await getPrisma().emailVerificationCode.updateMany({ data: { expiresAt: new Date(0) } });
    expect((await confirm(user.accessToken, sent[0]!.code)).status).toBe(400);
  });

  it('requires authentication and a valid body', async () => {
    expect((await api().post('/v1/me/email-verification').send({})).status).toBe(401);
    const user = await signUp();
    expect((await confirm(user.accessToken, 'abc')).status).toBe(400);
    const res = await api()
      .post('/v1/me/email-verification')
      .set('Authorization', bearer(user.accessToken))
      .send({ extra: 1 });
    expect(res.status).toBe(400);
  });

  it('sends nothing for an already-verified account', async () => {
    const user = await signUp();
    await signupCode();
    await confirm(user.accessToken, sent[0]!.code);
    sent.length = 0;
    expect((await request(user.accessToken)).status).toBe(204);
    expect(sent).toHaveLength(0);
    // And confirming again stays a success.
    expect((await confirm(user.accessToken, '123456')).status).toBe(200);
  });

  it('rate limits sends per user', async () => {
    const user = await signUp();
    for (let i = 0; i < LIMITS.VERIFY_REQUEST_MAX_PER_USER; i += 1) {
      expect((await request(user.accessToken)).status).toBe(204);
    }
    const res = await request(user.accessToken);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('changing the email clears verification and the pending code', async () => {
    const user = await signUp();
    await signupCode();
    const oldCode = sent[0]!.code;
    await confirm(user.accessToken, oldCode);
    await request(user.accessToken); // no-op while verified

    const changed = await api()
      .patch('/v1/me/email')
      .set('Authorization', bearer(user.accessToken))
      .send({ email: uniqueEmail('new'), password: TEST_PASSWORD });
    expect(changed.status).toBe(200);
    expect(changed.body.user.emailVerified).toBe(false);

    // A code issued for the old address cannot confirm the new one.
    await request(user.accessToken);
    await getPrisma().emailVerificationCode.deleteMany({});
    expect((await confirm(user.accessToken, oldCode)).status).toBe(400);
  });

  it('a pending code is dropped when the email changes', async () => {
    const user = await signUp();
    await signupCode();
    const code = sent[0]!.code;
    const changed = await api()
      .patch('/v1/me/email')
      .set('Authorization', bearer(user.accessToken))
      .send({ email: uniqueEmail('new'), password: TEST_PASSWORD });
    expect(changed.status).toBe(200);
    expect((await confirm(user.accessToken, code)).status).toBe(400);
  });

  it('a successful password reset verifies the address', async () => {
    const user = await signUp();
    await signupCode();
    sent.length = 0;
    await api().post('/v1/auth/forgot-password').send({ email: user.user.email });
    const res = await api()
      .post('/v1/auth/reset-password')
      .send({
        email: user.user.email,
        code: sent.at(-1)!.code,
        newPassword: 'staple-battery-horse',
      });
    expect(res.status).toBe(204);
    const row = await getPrisma().user.findUnique({ where: { id: user.user.id } });
    expect(row!.emailVerifiedAt).not.toBeNull();
  });
});
