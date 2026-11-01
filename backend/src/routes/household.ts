import {
  HouseholdCreateRequest,
  HouseholdInviteRequest,
  HouseholdInviteResponse,
  HouseholdJoinRequest,
  HouseholdLeaveRequest,
  HouseholdResponse,
  HouseholdTransferRequest,
  Uuid,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { sendJson } from '../http/respond.ts';
import { userIdOf } from '../http/types.ts';
import { householdJoinRateLimit } from '../middleware/householdJoinRateLimit.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  createHousehold,
  createInvite,
  deleteHousehold,
  getHousehold,
  joinHousehold,
  leaveHousehold,
  removeMember,
  requireSoleHouseholdId,
  transferHousehold,
} from '../services/householdService.ts';
import { problems } from '../errors.ts';

/**
 * `/v1/household` - shared households (`docs/design/10-households.md`).
 *
 * The older routes, for an app that predates several households: each acts on the caller's **one**
 * household, found from the access token (`household_ambiguous` once they are in more than one). The
 * id-addressed routes are in `households.ts`. Every handler uses `userIdOf` (who the caller *is*), not
 * `dataOwnerIdOf`: membership is about identity.
 */
export const householdRouter = Router();

householdRouter.get('/household', async (req: Request, res: Response) => {
  sendJson(res, 200, HouseholdResponse, await getHousehold(getPrisma(), userIdOf(req)));
});

householdRouter.post(
  '/household',
  validateBody(HouseholdCreateRequest),
  async (req: Request, res: Response) => {
    const body = req.body as HouseholdCreateRequest;
    sendJson(
      res,
      201,
      HouseholdResponse,
      await createHousehold(getPrisma(), userIdOf(req), body.name),
    );
  },
);

householdRouter.delete('/household', async (req: Request, res: Response) => {
  const db = getPrisma();
  await deleteHousehold(db, userIdOf(req), await requireSoleHouseholdId(db, userIdOf(req)));
  res.status(204).end();
});

householdRouter.post(
  '/household/invite',
  validateBody(HouseholdInviteRequest),
  async (req: Request, res: Response) => {
    const db = getPrisma();
    const householdId = await requireSoleHouseholdId(db, userIdOf(req));
    sendJson(res, 201, HouseholdInviteResponse, await createInvite(db, userIdOf(req), householdId));
  },
);

householdRouter.post(
  '/household/join',
  validateBody(HouseholdJoinRequest),
  householdJoinRateLimit,
  async (req: Request, res: Response) => {
    const body = req.body as HouseholdJoinRequest;
    sendJson(
      res,
      200,
      HouseholdResponse,
      await joinHousehold(getPrisma(), userIdOf(req), body.code),
    );
  },
);

householdRouter.post(
  '/household/leave',
  validateBody(HouseholdLeaveRequest),
  async (req: Request, res: Response) => {
    const db = getPrisma();
    await leaveHousehold(db, userIdOf(req), await requireSoleHouseholdId(db, userIdOf(req)));
    res.status(204).end();
  },
);

householdRouter.post(
  '/household/transfer',
  validateBody(HouseholdTransferRequest),
  async (req: Request, res: Response) => {
    const body = req.body as HouseholdTransferRequest;
    const db = getPrisma();
    const householdId = await requireSoleHouseholdId(db, userIdOf(req));
    sendJson(
      res,
      200,
      HouseholdResponse,
      await transferHousehold(db, userIdOf(req), householdId, body.memberId),
    );
  },
);

householdRouter.delete('/household/members/:memberId', async (req: Request, res: Response) => {
  const parsed = Uuid.safeParse(req.params.memberId);
  if (!parsed.success) throw problems.notFound('No such member.');
  const db = getPrisma();
  await removeMember(
    db,
    userIdOf(req),
    await requireSoleHouseholdId(db, userIdOf(req)),
    parsed.data,
  );
  res.status(204).end();
});
