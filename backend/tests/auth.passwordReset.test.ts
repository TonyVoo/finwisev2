import { LIMITS } from '@expense-tracker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import {
  createConsoleMailer,
  createResendMailer,
  setMailerForTests,
  type Mailer,
} from '../src/services/mailer.ts';
import { TEST_PASSWORD, api, signUp, uniqueEmail } from './support/api.ts';

/**
 * `POST /v1/auth/forgot-password` and `POST /v1/auth/reset-password`.
 *
 * What these pin is the part that is easy to get subtly wrong: that the endpoints never
 * say whether an email has an account, that a code dies after five wrong guesses and after
 * use, and that a reset ends every session. The mailer is replaced with one that records
 * what it was asked to send, which is also how a test gets hold of a code.
 */

const NEW_PASSWORD = 'staple-battery-horse';

let sent: { to: string; code: string }[];

beforeEach(() => {
  sent = [];
  const recording: Mailer = {
    async sendPasswordResetCode(to, code) {
      sent.push({ to, code });
    },
    async sendEmailVerificationCode() {},
  };
  setMailerForTests(recording);
});

afterEach(() => setMailerForTests(null));

const forgot = (email: string) => api().post('/v1/auth/forgot-password').send({ email });
const reset = (body: unknown) =>
  api()
    .post('/v1/auth/reset-password')
    .send(body as object);
const login = (email: string, password: string) =>
  api().post('/v1/auth/login').send({ email, password });

/** Ask for a code and return it. */
async function codeFor(email: string): Promise<string> {
  expect((await forgot(email)).status).toBe(204);
  const mail = sent.at(-1);
  expect(mail, 'no code was sent').toBeDefined();
  return mail!.code;
}

describe('POST /v1/auth/forgot-password', () => {
  it('emails a six-digit code to an account that exists', async () => {
    const user = await signUp();

    expect((await forgot(user.user.email)).status).toBe(204);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(user.user.email);
    expect(sent[0]!.code).toMatch(/^\d{6}$/);
  });

  it('answers 204 and sends nothing for an email with no account - the same as for one with', async () => {
    const known = await signUp();
    const a = await forgot(known.user.email);
    const b = await forgot(uniqueEmail('nobody'));

    expect(b.status).toBe(a.status);
    expect(b.status).toBe(204);
    expect(b.text).toBe(a.text);
    expect(sent).toHaveLength(1);
  });

  it('normalises the email like every other endpoint', async () => {
    const user = await signUp();
    expect((await forgot(`  ${user.user.email.toUpperCase()} `)).status).toBe(204);
    expect(sent).toHaveLength(1);
  });

  it('does not store the code, only a hash of it', async () => {
    const user = await signUp();
    const code = await codeFor(user.user.email);

    const row = await getPrisma().passwordResetCode.findUnique({ where: { userId: user.user.id } });
    expect(row).not.toBeNull();
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('replaces the earlier code, so only the newest works', async () => {
    const user = await signUp();
    const first = await codeFor(user.user.email);
    const second = await codeFor(user.user.email);

    expect(await getPrisma().passwordResetCode.count({ where: { userId: user.user.id } })).toBe(1);
    if (first !== second) {
      const stale = await reset({ email: user.user.email, code: first, newPassword: NEW_PASSWORD });
      expect(stale.status).toBe(400);
    }
    const fresh = await reset({ email: user.user.email, code: second, newPassword: NEW_PASSWORD });
    expect(fresh.status).toBe(204);
  });

  it('does not fail the request when the mail provider is down', async () => {
    setMailerForTests({
      sendPasswordResetCode: () => Promise.reject(new Error('provider down')),
      sendEmailVerificationCode: async () => {},
    });
    const user = await signUp();
    expect((await forgot(user.user.email)).status).toBe(204);
  });

  it('rejects a malformed email', async () => {
    const response = await forgot('not-an-email');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('is rate limited per email, counting every request and giving Retry-After', async () => {
    const user = await signUp();
    for (let i = 0; i < LIMITS.RESET_REQUEST_MAX_PER_EMAIL; i += 1) {
      expect((await forgot(user.user.email)).status).toBe(204);
    }
    const limited = await forgot(user.user.email);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // An email with no account is limited the same way, so volume reveals nothing.
    const ghost = uniqueEmail('ghost');
    for (let i = 0; i < LIMITS.RESET_REQUEST_MAX_PER_EMAIL; i += 1) await forgot(ghost);
    expect((await forgot(ghost)).status).toBe(429);
    // Another email is unaffected.
    const other = await signUp();
    expect((await forgot(other.user.email)).status).toBe(204);
  });
});

describe('POST /v1/auth/reset-password', () => {
  it('sets the new password: it logs in, the old one does not', async () => {
    const user = await signUp();
    const code = await codeFor(user.user.email);

    const response = await reset({
      email: user.user.email,
      code,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(204);
    expect((await login(user.user.email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(user.user.email, TEST_PASSWORD)).status).toBe(401);
  });

  it('ends every session of the account', async () => {
    const user = await signUp();
    const other = await login(user.user.email, TEST_PASSWORD);
    const code = await codeFor(user.user.email);

    await reset({ email: user.user.email, code, newPassword: NEW_PASSWORD });

    for (const refreshToken of [user.refreshToken, other.body.refreshToken as string]) {
      const refreshed = await api().post('/v1/auth/refresh').send({ refreshToken });
      expect(refreshed.status).toBe(401);
    }
  });

  it('works once: the same code is refused the second time', async () => {
    const user = await signUp();
    const code = await codeFor(user.user.email);

    expect((await reset({ email: user.user.email, code, newPassword: NEW_PASSWORD })).status).toBe(
      204,
    );
    const again = await reset({ email: user.user.email, code, newPassword: 'another-password-9' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('invalid_reset_code');
    expect((await login(user.user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it('refuses a wrong code with invalid_reset_code and changes nothing', async () => {
    const user = await signUp();
    const code = await codeFor(user.user.email);
    const wrong = code === '000000' ? '000001' : '000000';

    const response = await reset({
      email: user.user.email,
      code: wrong,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_reset_code');
    expect((await login(user.user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it(`kills the code after ${LIMITS.RESET_CODE_MAX_ATTEMPTS} wrong guesses, even for the right one`, async () => {
    const user = await signUp();
    const code = await codeFor(user.user.email);
    const wrong = code === '000000' ? '000001' : '000000';

    for (let i = 0; i < LIMITS.RESET_CODE_MAX_ATTEMPTS; i += 1) {
      const response = await reset({
        email: user.user.email,
        code: wrong,
        newPassword: NEW_PASSWORD,
      });
      expect(response.body.error.code).toBe('invalid_reset_code');
    }
    const late = await reset({ email: user.user.email, code, newPassword: NEW_PASSWORD });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('invalid_reset_code');
    expect((await login(user.user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('refuses an expired code', async () => {
    const user = await signUp();
    const code = await codeFor(user.user.email);
    await getPrisma().passwordResetCode.update({
      where: { userId: user.user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await reset({ email: user.user.email, code, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_reset_code');
  });

  it('gives an email with no account the same answer as a wrong code', async () => {
    const response = await reset({
      email: uniqueEmail('ghost'),
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_reset_code');
  });

  it("does not let one account's code reset another's", async () => {
    const a = await signUp();
    const b = await signUp();
    const codeA = await codeFor(a.user.email);
    await codeFor(b.user.email);

    const response = await reset({ email: b.user.email, code: codeA, newPassword: NEW_PASSWORD });
    if (codeA !== sent.at(-1)!.code) {
      expect(response.status).toBe(400);
      expect((await login(b.user.email, TEST_PASSWORD)).status).toBe(200);
    }
  });

  it('validates the code and the new password', async () => {
    const user = await signUp();
    for (const body of [
      { email: user.user.email, code: '12345', newPassword: NEW_PASSWORD },
      { email: user.user.email, code: 'abcdef', newPassword: NEW_PASSWORD },
      { email: user.user.email, code: '123456', newPassword: 'short' },
      { email: user.user.email, code: '123456', newPassword: NEW_PASSWORD, extra: 1 },
    ]) {
      const response = await reset(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });

  it('is rate limited per source address', async () => {
    for (let i = 0; i < LIMITS.RESET_ATTEMPT_MAX_PER_IP; i += 1) {
      await reset({ email: uniqueEmail('x'), code: '123456', newPassword: NEW_PASSWORD });
    }
    const limited = await reset({
      email: uniqueEmail('x'),
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
  });
});

describe('mailers', () => {
  it('posts the code to Resend with the key and sender, and throws on a non-2xx answer', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const mailer = createResendMailer({
      apiKey: 're_test',
      from: 'Expense Tracker <no-reply@example.com>',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await mailer.sendPasswordResetCode('sam@example.com', '482916');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    const body = JSON.parse(init.body as string) as { to: string[]; from: string; text: string };
    expect(body.to).toEqual(['sam@example.com']);
    expect(body.from).toBe('Expense Tracker <no-reply@example.com>');
    expect(body.text).toContain('482916');

    const failing = createResendMailer({
      apiKey: 're_test',
      from: 'x@example.com',
      fetchImpl: (async () => new Response('no', { status: 403 })) as unknown as typeof fetch,
    });
    await expect(failing.sendPasswordResetCode('a@example.com', '111111')).rejects.toThrow('403');
  });

  it('never reveals the code in the console mailer when told not to (production)', async () => {
    const mailer = createConsoleMailer({ revealCode: false });
    await expect(mailer.sendPasswordResetCode('a@example.com', '111111')).resolves.toBeUndefined();
  });
});
