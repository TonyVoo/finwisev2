import type { Response } from 'express';
import type { z } from 'zod';
import { getConfig } from '../config.ts';
import { logger } from '../logger.ts';

/**
 * Send a JSON response, checked against the `shared/` schema that declares it.
 *
 * This is the cheap half of the anti-drift mechanism. `shared/` already stops the two
 * sides disagreeing about what a shape *is*; this stops the server from disagreeing with
 * `shared/` about what it actually sends. A handler that forgets `revision`, or leaks a
 * `passwordHash` through a spread, fails its own test rather than a mobile build a week
 * later.
 *
 * Off in production, where the schemas have already done their job in CI and the cost
 * would be paid on every sync page.
 */
export function sendJson<S extends z.ZodType>(
  res: Response,
  status: number,
  schema: S,
  body: z.infer<S>,
): void {
  const { validateResponses } = getConfig();
  if (!validateResponses) {
    res.status(status).json(body);
    return;
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    // Throwing turns a contract violation into a 500 that the test suite will not let
    // past, which is the point: silently shipping a wrong shape is the failure mode this
    // exists to prevent.
    logger.error('response failed its own contract schema', {
      requestId: res.req.requestId,
      path: res.req.originalUrl,
      issues: result.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`),
    });
    throw new Error(`Response body does not match the contract for ${res.req.originalUrl}`);
  }
  res.status(status).json(result.data);
}
