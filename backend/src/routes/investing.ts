import {
  InvestingPutRequest,
  InvestingPutResponse,
  InvestingResponse,
  PushTokenRequest,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { sendJson } from '../http/respond.ts';
import { userIdOf } from '../http/types.ts';
import { validateBody } from '../middleware/validate.ts';
import { getInvesting, putInvesting, registerPushToken } from '../services/investingService.ts';

/**
 * `/v1/me/investing` and `/v1/me/push-token`: the account's watchlist and price alerts, and the devices to push to.
 * Always the signed-in person's own, never a household's: a watchlist is not a shared book.
 */
export const investingRouter = Router();

investingRouter.get('/me/investing', async (req: Request, res: Response) => {
  sendJson(res, 200, InvestingResponse, { data: await getInvesting(userIdOf(req)) });
});

investingRouter.put(
  '/me/investing',
  validateBody(InvestingPutRequest),
  async (req: Request, res: Response) => {
    const result = await putInvesting(userIdOf(req), req.body as InvestingPutRequest);
    sendJson(res, 200, InvestingPutResponse, result);
  },
);

investingRouter.post(
  '/me/push-token',
  validateBody(PushTokenRequest),
  async (req: Request, res: Response) => {
    await registerPushToken(userIdOf(req), req.body as PushTokenRequest);
    res.status(204).end();
  },
);
