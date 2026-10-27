import { SyncPullQuery, SyncPullResponse, SyncPushResponse } from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { sendJson } from '../http/respond.ts';
import { dataOwnerIdOf, userIdOf } from '../http/types.ts';
import { validateQuery, validatedQuery } from '../middleware/validate.ts';
import { pullChanges } from '../services/syncPullService.ts';
import { pushChanges } from '../services/syncPushService.ts';
import { parsePushBatch } from '../sync/batch.ts';

/**
 * `/v1/sync` — the offline-first protocol.
 *
 * Both handlers stay thin, as elsewhere, with one deliberate difference: the push does
 * **not** use `validateBody`. A batch cannot be validated as a single body, because a
 * `400` for one malformed row would wedge an offline client's outbox forever — every
 * good change queued behind it would stop draining too. `parsePushBatch` validates the
 * envelope and then each item separately, so a bad row becomes a per-record `invalid`.
 * See `sync/batch.ts`.
 */
export const syncRouter = Router();

syncRouter.get('/sync', validateQuery(SyncPullQuery), async (req: Request, res: Response) => {
  const query = validatedQuery(res, SyncPullQuery);
  const body = await pullChanges(getPrisma(), dataOwnerIdOf(req), query);
  sendJson(res, 200, SyncPullResponse, body);
});

syncRouter.post('/sync', async (req: Request, res: Response) => {
  const parsed = parsePushBatch(req.body);
  const body = await pushChanges(getPrisma(), dataOwnerIdOf(req), parsed, userIdOf(req));
  // `200`, not `201`: a batch is not a resource, and whether anything was created is a
  // per-record question that `results[].status` answers.
  sendJson(res, 200, SyncPushResponse, body);
});
