import { HealthResponse, apiError } from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getConfig } from '../config.ts';
import { getPrisma } from '../db/client.ts';
import { sendJson } from '../http/respond.ts';
import { logger } from '../logger.ts';

/**
 * `GET /v1/health` — the only unauthenticated, non-auth endpoint.
 *
 * Postgres connectivity is part of liveness on purpose: this API is useless without the
 * database, so an instance that cannot reach it must not report itself healthy or it
 * will keep receiving traffic it can only fail. Hence `503` rather than a `200` with
 * `db: "down"` — the contract has no such state, and a load balancer reads the status
 * code, not the body.
 */
export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const { version } = getConfig();

  try {
    await getPrisma().$queryRaw`SELECT 1`;
  } catch (error) {
    logger.error('health check: database unreachable', {
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json(apiError('internal_error', 'Database connectivity check failed.'));
    return;
  }

  sendJson(res, 200, HealthResponse, {
    status: 'ok',
    version,
    time: new Date().toISOString(),
    db: 'up',
  });
});
