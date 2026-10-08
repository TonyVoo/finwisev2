import { apiError } from '@expense-tracker/shared';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { isApiProblem, problems } from '../errors.ts';
import { logger } from '../logger.ts';

/**
 * The single exit for every failure.
 *
 * The contract promises that *every* non-2xx body is `{ error: { code, message } }`, so
 * this is registered last and is the only place a non-2xx body is written. Handlers
 * throw an `ApiProblem`; anything else that escapes is a bug and becomes
 * `500 internal_error` with the detail kept in the logs.
 */

/** Unmatched route. A 404 is the contract's answer for "no such route", same envelope. */
export const notFoundHandler: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  next(problems.notFound(`No route for ${req.method} ${req.path}.`));
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Nothing can be done once the status line and headers are out; handing it back to
  // Express at least closes the connection rather than emitting a second body.
  if (res.headersSent) {
    logger.error('error raised after response was sent', {
      requestId: req.requestId,
      path: req.originalUrl,
      message: error instanceof Error ? error.message : String(error),
    });
    next(error);
    return;
  }

  if (isApiProblem(error)) {
    // Expected failures are logged at info/warn: a 401 on login is the system working.
    // 5xx-mapped problems are the exception and deserve the louder level.
    const level = error.status >= 500 ? 'error' : 'info';
    logger[level]('request failed', {
      requestId: req.requestId,
      path: req.originalUrl,
      status: error.status,
      code: error.code,
    });
    res.status(error.status).json(error.toEnvelope());
    return;
  }

  // Anything reaching here is unplanned. Log the stack, return the contract's opaque
  // 500: the client gets the request id to quote, and nothing about our internals.
  logger.error('unhandled error', {
    requestId: req.requestId,
    path: req.originalUrl,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  res.status(500).json(apiError('internal_error', 'Something went wrong.'));
};
