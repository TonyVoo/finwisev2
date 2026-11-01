import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { userIdOf } from '../http/types.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';

/**
 * Per-account throttle on `POST /quick-add`. A sentence may spend the model's free quota, so an account
 * gets {@link LIMITS.QUICK_ADD_MAX_PER_USER} per window, counted before the sentence is looked at.
 */
const readsByUser = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

export function quickAddRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const state = readsByUser.hit(userIdOf(req), Date.now());
  if (state.count <= LIMITS.QUICK_ADD_MAX_PER_USER) {
    next();
    return;
  }
  logger.warn('quick add rate limited', { requestId: req.requestId });
  next(problems.rateLimited(state.retryAfterSeconds));
}

export function resetQuickAddRateLimitForTests(): void {
  readsByUser.reset();
}
