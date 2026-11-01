import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { userIdOf } from '../http/types.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';

/**
 * Per-account throttle on `POST /recap`. A recap may spend the model's free quota, so an account gets
 * {@link LIMITS.RECAP_MAX_PER_USER} per window, counted before the facts are looked at.
 */
const recapsByUser = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

export function recapRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const state = recapsByUser.hit(userIdOf(req), Date.now());
  if (state.count <= LIMITS.RECAP_MAX_PER_USER) {
    next();
    return;
  }
  logger.warn('recap rate limited', { requestId: req.requestId });
  next(problems.rateLimited(state.retryAfterSeconds));
}

export function resetRecapRateLimitForTests(): void {
  recapsByUser.reset();
}
