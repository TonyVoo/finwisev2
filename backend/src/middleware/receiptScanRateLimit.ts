import { LIMITS } from '@expense-tracker/shared';
import type { NextFunction, Request, Response } from 'express';
import { problems } from '../errors.ts';
import { userIdOf } from '../http/types.ts';
import { logger } from '../logger.ts';
import { FixedWindowCounter } from '../rateLimit/fixedWindow.ts';

/**
 * Per-account throttle on `POST /receipts/scan`. Every reading spends the server's budget with
 * the OCR provider, so an account gets {@link LIMITS.RECEIPT_SCAN_MAX_PER_USER} per window,
 * counted before the image is looked at: a flood of unreadable files costs as much as good ones.
 */
const scansByUser = new FixedWindowCounter(LIMITS.LOGIN_RATE_LIMIT_WINDOW_SECONDS);

export function receiptScanRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const state = scansByUser.hit(userIdOf(req), Date.now());
  if (state.count <= LIMITS.RECEIPT_SCAN_MAX_PER_USER) {
    next();
    return;
  }
  logger.warn('receipt scan rate limited', { requestId: req.requestId });
  next(problems.rateLimited(state.retryAfterSeconds));
}

export function resetReceiptScanRateLimitForTests(): void {
  scansByUser.reset();
}
