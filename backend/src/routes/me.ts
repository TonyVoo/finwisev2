import {
  ChangeEmailRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  MeResponse,
  TokenPair,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { toWireUser } from '../db/mappers.ts';
import { isApiProblem, problems } from '../errors.ts';
import {
  passwordConfirmRateLimit,
  recordPasswordConfirmFailure,
  recordPasswordConfirmSuccess,
} from '../middleware/passwordConfirmRateLimit.ts';
import { validateBody } from '../middleware/validate.ts';
import { changeEmail, changePassword, deleteAccount } from '../services/authService.ts';
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

/**
 * Run a password-confirming action under the per-user throttle.
 *
 * A wrong answer (`forbidden`) counts against the budget; a right one clears it; anything
 * else - a 500, a vanished account - is neither, because a server fault is not evidence of
 * guessing and must not be able to lock a user out.
 */
async function confirmed<T>(userId: string, action: () => Promise<T>): Promise<T> {
  try {
    const result = await action();
    recordPasswordConfirmSuccess(userId);
    return result;
  } catch (error) {
    if (isApiProblem(error) && error.code === 'forbidden') recordPasswordConfirmFailure(userId);
    throw error;
  }
}

meRouter.post(
  '/me/password',
  validateBody(ChangePasswordRequest),
  passwordConfirmRateLimit,
  async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const body = req.body as ChangePasswordRequest;
    const tokens = await confirmed(userId, () => changePassword(getPrisma(), userId, body));
    sendJson(res, 200, TokenPair, tokens);
  },
);

meRouter.patch(
  '/me/email',
  validateBody(ChangeEmailRequest),
  passwordConfirmRateLimit,
  async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const body = req.body as ChangeEmailRequest;
    const user = await confirmed(userId, () => changeEmail(getPrisma(), userId, body));
    sendJson(res, 200, MeResponse, { user });
  },
);

meRouter.delete(
  '/me',
  validateBody(DeleteAccountRequest),
  passwordConfirmRateLimit,
  async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const body = req.body as DeleteAccountRequest;
    await confirmed(userId, () => deleteAccount(getPrisma(), userId, body.password));
    res.status(204).end();
  },
);
