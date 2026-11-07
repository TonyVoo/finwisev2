import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { userIdOf } from '../http/types.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';

/**
 * Per-account throttle on `POST /assistant/ask`. Every question is a model call, so an account gets
 * {@link LIMITS.ASSISTANT_MAX_PER_USER} per window, counted before the question is looked at.
 */
const asksByUser = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

export function assistantRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const state = asksByUser.hit(userIdOf(req), Date.now());
  if (state.count <= LIMITS.ASSISTANT_MAX_PER_USER) {
    next();
    return;
  }
  logger.warn('assistant rate limited', { requestId: req.requestId });
  next(problems.rateLimited(state.retryAfterSeconds));
}

export function resetAssistantRateLimitForTests(): void {
  asksByUser.reset();
}
