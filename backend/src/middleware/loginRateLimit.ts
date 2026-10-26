import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';
import { normaliseEmail } from '../services/authService.ts';

/**
 * Login throttling, the thing standing between an attacker and an unbounded guess rate.
 *
 * Before this existed, the only cost of a wrong password was the argon2id verify — about
 * 17ms, so ~60 guesses a second on one connection and as many connections as the
 * attacker cares to open. `docs/api/openapi.yaml` has always said login is "rate limited
 * per email and per source address" and `shared/src/errors.ts` has always reserved
 * `rate_limited`; this is that promise, kept. `TVO-38`.
 *
 * ## Two buckets, because one of them is bypassable
 *
 *  * **Per email** ({@link LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL}) defends one account
 *    against a dictionary run. Alone it is no defence at all against *spraying* — one
 *    guess of `Password1!` against each of a thousand accounts never reaches a second
 *    failure on any single email.
 *  * **Per source address** ({@link LIMITS.LOGIN_MAX_FAILURES_PER_IP}) is the bucket that
 *    catches the spray. Alone it is no defence either, because an attacker with a
 *    thousand addresses gets a thousand budgets against one account.
 *
 * Both or neither. Either one on its own has a shape of attack it does not see.
 *
 * ## Failures only
 *
 * Neither bucket counts a successful login. Counting successes would mean every user
 * behind one office or carrier NAT shares the per-address budget, which is not a
 * security measure, it is an outage. An attacker's traffic is made of failures, so the
 * threat stays bounded either way. See `LIMITS` for the rest of the reasoning.
 *
 * ## Checked before the password is verified
 *
 * The check runs as middleware, ahead of the handler, so a request over the limit costs
 * one map lookup rather than one argon2 verify. That ordering is the point: it is what
 * stops the endpoint from being a CPU-exhaustion lever as well as a guessing oracle.
 *
 * ## What this deliberately does not do
 *
 * There is no permanent lockout and no record in the database. A 15-minute window that
 * forgets is the right trade for an MVP: an attacker who can lock an account out by
 * failing against it is a denial-of-service of their own, and the shorter the window the
 * less that is worth. The consequence to be honest about is that a user whose email is
 * targeted can be locked out for up to the window; see `GAP 10` in
 * `docs/qa/TEST_PLAN.md` for where the numbers are owned.
 */

const emailFailures = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
const addressFailures = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

/**
 * The key a login request is counted under, per bucket.
 *
 * The email is normalised with the same function the account lookup uses, which is not a
 * detail: keying on the raw string would make `A@x.com`, `a@x.com` and ` a@x.com ` three
 * budgets against one account, and the limiter would be bypassable by anyone who noticed.
 *
 * The address falls back to a single shared `unknown` bucket rather than to no limit at
 * all. `req.ip` is undefined only when the socket has no remote address, which in
 * practice means a synthetic request; sharing one bucket is the conservative reading.
 */
function keysFor(req: Request, email: string): { emailKey: string; addressKey: string } {
  return { emailKey: normaliseEmail(email), addressKey: req.ip ?? 'unknown' };
}

/**
 * Reject the request if either bucket is already at its limit.
 *
 * Mount *after* `validateBody(LoginRequest)`: this reads `req.body.email` and relies on
 * the schema having already established that it is a string of bounded length. Ahead of
 * validation it would be keying buckets on arbitrary attacker-supplied values.
 */
export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as { email?: unknown };
  if (typeof body?.email !== 'string') {
    // Unreachable behind `validateBody`. If the order is ever changed, fail open on the
    // limiter rather than 500 a request the validator is about to reject anyway.
    next();
    return;
  }

  const { emailKey, addressKey } = keysFor(req, body.email);
  const now = Date.now();

  const byEmail = emailFailures.peek(emailKey, now);
  const byAddress = addressFailures.peek(addressKey, now);

  const overEmail = byEmail.count >= LIMITS.LOGIN_MAX_FAILURES_PER_EMAIL;
  const overAddress = byAddress.count >= LIMITS.LOGIN_MAX_FAILURES_PER_IP;
  if (!overEmail && !overAddress) {
    next();
    return;
  }

  // Both tripped: wait out the longer of the two, so one obedient retry is enough.
  const retryAfterSeconds = Math.max(
    overEmail ? byEmail.retryAfterSeconds : 0,
    overAddress ? byAddress.retryAfterSeconds : 0,
  );

  // Logged at `warn`, unlike the `401` it replaces: a single wrong password is the system
  // working, but something hitting the threshold is worth being able to find later. The
  // email is not logged — this line would otherwise be a list of targeted accounts in a
  // file with a wider audience than the users table.
  logger.warn('login rate limited', {
    requestId: req.requestId,
    bucket: overEmail && overAddress ? 'email+address' : overEmail ? 'email' : 'address',
    retryAfterSeconds,
  });

  next(problems.rateLimited(retryAfterSeconds));
}

/**
 * Record a failed credential check against both buckets.
 *
 * Called by the login handler on `invalid_credentials` and on nothing else. In
 * particular a `500` must not count: a server fault is not evidence of guessing, and
 * counting it would let a bug lock every user out.
 */
export function recordLoginFailure(req: Request, email: string): void {
  const { emailKey, addressKey } = keysFor(req, email);
  const now = Date.now();
  emailFailures.hit(emailKey, now);
  addressFailures.hit(addressKey, now);
}

/**
 * Clear the email bucket after a successful login.
 *
 * The address bucket is deliberately left alone. A user who mistypes twice and then gets
 * in should start from zero, but an attacker who lands one guess part-way through a spray
 * should not have the rest of their budget refunded.
 */
export function recordLoginSuccess(req: Request, email: string): void {
  emailFailures.clear(keysFor(req, email).emailKey);
}

/** Test-only: drop every count, so one test's failures cannot limit the next one. */
export function resetLoginRateLimitForTests(): void {
  emailFailures.reset();
  addressFailures.reset();
}
