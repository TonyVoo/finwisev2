import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';
import { normaliseEmail } from '../services/authService.ts';

/**
 * Throttling for the two password-reset endpoints.
 *
 * Unlike the login limiter, these count **every** request and not just failures. The
 * reason is the point of the endpoints: `forgot-password` answers identically whether or
 * not the account exists, so there is no failure to count, and what needs bounding is
 * volume - mail-bombing one inbox, and enumerating addresses by hammering. `reset-password`
 * is bounded per code by its own attempt cap; the per-address bucket here is what stops
 * one source from trying many accounts' codes.
 *
 * The windows are the login window, and like it these live in process memory (see
 * `rateLimit/fixedWindow.ts` for what that does and does not guarantee).
 */

const requestsByEmail = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
const requestsByAddress = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
const attemptsByAddress = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

function reject(req: Request, next: NextFunction, bucket: string, retryAfterSeconds: number): void {
  // Neither the email nor the address is logged: this line would be a list of who asked.
  logger.warn('password reset rate limited', {
    requestId: req.requestId,
    bucket,
    retryAfterSeconds,
  });
  next(problems.rateLimited(retryAfterSeconds));
}

/** Mount after `validateBody(ForgotPasswordRequest)`: it keys on the validated email. */
export function forgotPasswordRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const body = req.body as { email?: unknown };
  const address = req.ip ?? 'unknown';
  const now = Date.now();

  const byAddress = requestsByAddress.hit(address, now);
  const byEmail =
    typeof body?.email === 'string'
      ? requestsByEmail.hit(normaliseEmail(body.email), now)
      : { count: 0, retryAfterSeconds: 0 };

  const overEmail = byEmail.count > LIMITS.RESET_REQUEST_MAX_PER_EMAIL;
  const overAddress = byAddress.count > LIMITS.RESET_REQUEST_MAX_PER_IP;
  if (!overEmail && !overAddress) {
    next();
    return;
  }
  reject(
    req,
    next,
    overEmail ? 'email' : 'address',
    Math.max(
      overEmail ? byEmail.retryAfterSeconds : 0,
      overAddress ? byAddress.retryAfterSeconds : 0,
    ),
  );
}

export function resetPasswordRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const state = attemptsByAddress.hit(req.ip ?? 'unknown', Date.now());
  if (state.count <= LIMITS.RESET_ATTEMPT_MAX_PER_IP) {
    next();
    return;
  }
  reject(req, next, 'address', state.retryAfterSeconds);
}

/** Test-only: forget every count. */
export function resetPasswordResetRateLimitForTests(): void {
  requestsByEmail.reset();
  requestsByAddress.reset();
  attemptsByAddress.reset();
}
