import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';
import { userIdOf } from '../http/types.ts';

/**
 * Per-user throttle on `POST /me/email-verification`. Counts every request: what needs
 * bounding is volume (mail-bombing the account's inbox, and burning the mail quota), not
 * failures. Wrong guesses are bounded per code by the code's own attempt cap.
 */
const sendsByUser = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

export function emailVerificationSendRateLimit(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const state = sendsByUser.hit(userIdOf(req), Date.now());
  if (state.count <= LIMITS.VERIFY_REQUEST_MAX_PER_USER) {
    next();
    return;
  }
  logger.warn('email verification rate limited', {
    requestId: req.requestId,
    retryAfterSeconds: state.retryAfterSeconds,
  });
  next(problems.rateLimited(state.retryAfterSeconds));
}

export function resetEmailVerificationRateLimitForTests(): void {
  sendsByUser.reset();
}
