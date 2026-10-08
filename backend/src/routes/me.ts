import { MeResponse } from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { toWireUser } from '../db/mappers.ts';
import { problems } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import { userIdOf } from '../http/types.ts';

/**
 * `GET /v1/me` — the user the access token belongs to.
 *
 * The mobile app calls this on start as a cheap token-validity check, and reads the
 * account's `currency` from it.
 */
export const meRouter = Router();

meRouter.get('/me', async (req: Request, res: Response) => {
  const userId = userIdOf(req);
  const user = await getPrisma().user.findUnique({ where: { id: userId } });

  if (!user) {
    // The signature verified but the row is gone (deleted account, or a token minted
    // against a database that has since been reset). `token_invalid` and not `404`,
    // because the client's correct response is to re-login, not to retry.
    throw problems.tokenInvalid('Access token does not belong to an existing account.');
  }

  sendJson(res, 200, MeResponse, { user: toWireUser(user) });
});
