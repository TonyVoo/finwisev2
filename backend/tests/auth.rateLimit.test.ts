import { LIMITS } from '@expense-tracker/shared';
import type { ApiError } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { TEST_PASSWORD, api, bearer, uniqueEmail } from './support/api.ts';

/**
 * Login throttling at the HTTP layer. `TVO-38`.
 *
 * The defect this suite closes was that there was no limiter at all: 25 wrong passwords
 * in 421ms, all answered `401`, so an attacker's guess rate was bounded by the argon2id
 * verify alone. The counter primitive is tested on its own in
 * `rateLimit.fixedWindow.test.ts`; everything here goes through the real app, because
 * the ordering (limiter ahead of the password check), the `Retry-After` header and the
 * `ApiError` envelope only exist once the middleware is mounted.
 *
 * Thresholds are read from `LIMITS` rather than written as literals. If the numbers are
 * revised - `GAP 10` in `docs/qa/TEST_PLAN.md` leaves that with whoever owns them - these
 * cases should follow without being edited, and the one case that *is* about a specific
 * figure says so.
 *
 * `tests/setup.ts` resets the counters before each test. They live in the process rather
 * than the database, so `truncateAll` does not reach them.
 */

const WRONG = 'definitely-not-the-password';

/** Fail `times` logins for `email` and return the status of each. */
async function failLogins(email: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const response = await api().post('/v1/auth/login').send({ email, password: WRONG });
    statuses.push(response.status);
  }
  return statuses;
}

describe('POST /v1/auth/login - per-email throttling', () => {
  it('answers 401 up to the threshold and 429 after it', async () => {
    const email = uniqueEmail('ratelimit-email');
    const signup = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });
    expect(signup.status).toBe(201);

    const limit = LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL;

    // Exactly `limit` attempts are answered. The threshold is the number of failures
    // allowed, not the number of requests, so the 429 is the attempt *after* the last
    // counted failure.
    expect(new Set(await failLogins(email, limit))).toEqual(new Set([401]));

    const blocked = await api().post('/v1/auth/login').send({ email, password: WRONG });
    expect(blocked.status).toBe(429);
  });

  it('returns the contract envelope and a Retry-After a client can obey', async () => {
    const email = uniqueEmail('ratelimit-shape');
    await failLogins(email, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL);

    const blocked = await api().post('/v1/auth/login').send({ email, password: WRONG });
    expect(blocked.status).toBe(429);

    // The one error shape, same as every other non-2xx in this API.
    const body = blocked.body as ApiError;
    expect(body.error.code).toBe('rate_limited');
    expect(typeof body.error.message).toBe('string');

    // The mobile client backs off by this number, so it has to parse as a non-negative
    // integer of seconds - and be inside the window, not some larger invented figure.
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

    // Still correlatable: a 429 is not an excuse to drop the request id.
    expect(blocked.headers['x-request-id']).toBeTruthy();
  });

  it('blocks an email with no account exactly as it blocks one with an account', async () => {
    // The limiter must not become the account-enumeration oracle that
    // `invalid_credentials` was carefully written not to be. Keying on the submitted
    // address without looking it up is what makes the two indistinguishable, and this is
    // the case that would catch a "look the user up first" refactor.
    const unknown = uniqueEmail('ratelimit-no-such-account');
    expect(new Set(await failLogins(unknown, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL))).toEqual(
      new Set([401]),
    );

    const blocked = await api().post('/v1/auth/login').send({ email: unknown, password: WRONG });
    expect(blocked.status).toBe(429);
    expect((blocked.body as ApiError).error.code).toBe('rate_limited');
  });

  it('counts case and whitespace variants of one address as one bucket', async () => {
    // `normaliseEmail` is what the account lookup uses, so the limiter uses it too.
    // Keying on the raw string would give `A@x.com`, `a@x.com` and ` a@x.com ` three
    // budgets against one account - a bypass anyone who noticed could drive.
    const email = uniqueEmail('ratelimit-Normalise');
    const variants = [email.toLowerCase(), email.toUpperCase(), ` ${email} `];

    for (let i = 0; i < LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL; i += 1) {
      const variant = variants[i % variants.length] as string;
      const response = await api().post('/v1/auth/login').send({ email: variant, password: WRONG });
      expect(response.status).toBe(401);
    }

    for (const variant of variants) {
      const blocked = await api().post('/v1/auth/login').send({ email: variant, password: WRONG });
      expect(blocked.status).toBe(429);
    }
  });

  it('does not let one email exhaust another email, below the address limit', async () => {
    const victim = uniqueEmail('ratelimit-victim');
    const bystander = uniqueEmail('ratelimit-bystander');
    const signup = await api()
      .post('/v1/auth/signup')
      .send({ email: bystander, password: TEST_PASSWORD });
    expect(signup.status).toBe(201);

    await failLogins(victim, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL);
    const blocked = await api().post('/v1/auth/login').send({ email: victim, password: WRONG });
    expect(blocked.status).toBe(429);

    // The bystander still logs in. Their failures are nowhere near the per-address limit,
    // and a per-email bucket that leaked into other emails would be a lockout lever.
    const login = await api()
      .post('/v1/auth/login')
      .send({ email: bystander, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('clears the count on a successful login', async () => {
    const email = uniqueEmail('ratelimit-reset');
    await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });

    // One short of the threshold, then the right password: a user who mistypes several
    // times and then gets in must not be left one attempt from a lockout.
    await failLogins(email, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL - 1);
    const ok = await api().post('/v1/auth/login').send({ email, password: TEST_PASSWORD });
    expect(ok.status).toBe(200);

    // Back to a full budget rather than to the one remaining attempt.
    expect(new Set(await failLogins(email, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL))).toEqual(
      new Set([401]),
    );
  });

  it('rejects before the password is verified, so a correct password does not get in', async () => {
    const email = uniqueEmail('ratelimit-correct-password');
    await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });
    await failLogins(email, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL);

    // The limiter runs as middleware, ahead of the handler. That ordering is the whole
    // protection: if the check happened after the verify, every blocked request would
    // still cost an argon2 hash and the endpoint would stay a CPU-exhaustion lever.
    const blocked = await api().post('/v1/auth/login').send({ email, password: TEST_PASSWORD });
    expect(blocked.status).toBe(429);
    expect((blocked.body as ApiError).error.code).toBe('rate_limited');
  });

  it('does not count a request the schema rejects', async () => {
    const email = uniqueEmail('ratelimit-invalid-body');

    // A body that never reaches the credential check is not a guess. `validateBody` runs
    // first, so these are 400s that cost nothing and must not fill a bucket - otherwise
    // a client with a bug in its request builder would lock its own user out.
    for (let i = 0; i < LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL * 2; i += 1) {
      const response = await api().post('/v1/auth/login').send({ email, password: 'short' });
      expect(response.status).toBe(400);
    }

    const after = await api().post('/v1/auth/login').send({ email, password: WRONG });
    expect(after.status).toBe(401);
  });
});

describe('POST /v1/auth/login - per-source-address throttling', () => {
  it('stops a spray across many emails that never trips the per-email limit', async () => {
    /**
     * The attack the per-email bucket cannot see: one guess against each of many
     * accounts. Below the per-email threshold on every address, so only the per-address
     * bucket can catch it - and this is the case that fails if that bucket is removed.
     *
     * The emails are distinct per iteration, which is also why this is slower than the
     * other cases: every failure still pays the argon2 verify, by design, because
     * skipping it for an unknown email would time-leak which addresses have accounts.
     */
    const limit = LIMITS.LOGIN_MAX_FAILURES_PER_IP;
    const statuses: number[] = [];
    for (let i = 0; i < limit; i += 1) {
      const response = await api()
        .post('/v1/auth/login')
        .send({ email: uniqueEmail(`spray-${i}`), password: WRONG });
      statuses.push(response.status);
    }
    expect(new Set(statuses)).toEqual(new Set([401]));

    const blocked = await api()
      .post('/v1/auth/login')
      .send({ email: uniqueEmail('spray-final'), password: WRONG });
    expect(blocked.status).toBe(429);
    expect((blocked.body as ApiError).error.code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  }, 60_000);

  it('is more generous than the per-email limit, because addresses are shared', () => {
    // Not an arbitrary assertion about two constants: many unrelated users legitimately
    // share one office or carrier address, so the address bucket has to clear the
    // per-email one or the limiter denies service to honest traffic before it bothers an
    // attacker.
    expect(LIMITS.LOGIN_MAX_FAILURES_PER_IP).toBeGreaterThan(LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL);
  });
});

describe('the limiter is scoped to login', () => {
  it('does not throttle signup or the authenticated routes', async () => {
    const email = uniqueEmail('ratelimit-scope');
    const signup = await api().post('/v1/auth/signup').send({ email, password: TEST_PASSWORD });
    expect(signup.status).toBe(201);

    // Exhaust the login budget for this email.
    await failLogins(email, LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL + 1);

    // The session issued before the block still works. The limiter guards the credential
    // endpoint, not the account: locking a logged-in user out of their own expenses
    // because someone guessed at their email would be the limiter causing the outage.
    const auth = bearer(signup.body.accessToken as string);
    for (let i = 0; i < 5; i += 1) {
      const read = await api().get('/v1/expenses').set('Authorization', auth);
      expect(read.status).toBe(200);
    }

    // And a different account can still be created from the same address. `TVO-38` is
    // about login; signup's own limit is a separate question and not claimed here.
    const other = await api()
      .post('/v1/auth/signup')
      .send({ email: uniqueEmail('ratelimit-scope-other'), password: TEST_PASSWORD });
    expect(other.status).toBe(201);
  });
});
