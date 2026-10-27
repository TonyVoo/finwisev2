import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';
import { userIdOf } from '../http/types.ts';

/**
 * Per-account throttle on `POST /household/join`, counting every attempt whatever the
 * outcome. An invite code is 8 characters from a 31-character alphabet and works for 48
 * hours, so what keeps it from being guessed is this budget rather than the code's length
 * alone: a signed-in account gets {@link LIMITS.INVITE_JOIN_MAX_PER_USER} tries per window.
 */
const attemptsByUser = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

export function householdJoinRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const state = attemptsByUser.hit(userIdOf(req), Date.now());
  if (state.count <= LIMITS.INVITE_JOIN_MAX_PER_USER) {
    next();
    return;
  }
  logger.warn('household join rate limited', { requestId: req.requestId });
  next(problems.rateLimited(state.retryAfterSeconds));
}

export function resetHouseholdJoinRateLimitForTests(): void {
  attemptsByUser.reset();
}
