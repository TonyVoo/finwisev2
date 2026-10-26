import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { userIdOf } from '../http/types.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';

/**
 * Throttle for the endpoints that ask a *signed-in* user to re-enter their password:
 * `POST /v1/me/password` and `DELETE /v1/me`.
 *
 * They are guessing oracles for the password in the same way login is, with one
 * difference that makes them worse: a stolen access token is enough to reach them, and
 * without a limit that token would buy unlimited guesses at the password behind it - which
 * is then good for every other device and for the account's lifetime, not just the hour the
 * token lives. So they get a budget.
 *
 * One bucket keyed on the user, shared by both endpoints (guessing through one must not
 * leave a fresh budget on the other). No per-address bucket: login needs one because an
 * attacker spreads across accounts, but here the account is already fixed by the token.
 *
 * Same discipline as `loginRateLimit`: failures only, checked before argon2 so a request
 * over the limit costs a map lookup, cleared by a correct answer, and forgotten after the
 * window rather than locking anyone out permanently.
 */

const failures = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

/** Mount *after* `requireAuth`: it reads the user id the token established. */
export function passwordConfirmRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const userId = userIdOf(req);
  const state = failures.peek(userId, Date.now());
  if (state.count < LIMITS.PASSWORD_CONFIRM_MAX_FAILURES_PER_USER) {
    next();
    return;
  }

  logger.warn('password confirmation rate limited', {
    requestId: req.requestId,
    userId,
    retryAfterSeconds: state.retryAfterSeconds,
  });
  next(problems.rateLimited(state.retryAfterSeconds));
}

/** Count a wrong answer. Called on that outcome and on nothing else - a 500 is not a guess. */
export function recordPasswordConfirmFailure(userId: string): void {
  failures.hit(userId, Date.now());
}

/** A correct answer starts the user from zero. */
export function recordPasswordConfirmSuccess(userId: string): void {
  failures.clear(userId);
}

/** Test-only: drop every count so one test's failures cannot limit the next. */
export function resetPasswordConfirmRateLimitForTests(): void {
  failures.reset();
}
