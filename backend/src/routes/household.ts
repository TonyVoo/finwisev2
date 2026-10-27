import {
  HouseholdCreateRequest,
  HouseholdInviteRequest,
  HouseholdInviteResponse,
  HouseholdJoinRequest,
  HouseholdLeaveRequest,
  HouseholdResponse,
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
} from '../services/householdService.ts';
import { problems } from '../errors.ts';

/**
 * `/v1/household` - shared households (`docs/design/10-households.md`).
 *
 * The household is found from the access token and never addressed by an id in the URL, so no
 * route can be pointed at a household the caller is not in. Every handler uses `userIdOf`
 * (who the caller *is*), not `dataOwnerIdOf`: membership is about identity.
 */
export const householdRouter = Router();

householdRouter.get('/household', async (req: Request, res: Response) => {
  sendJson(res, 200, HouseholdResponse, await getHousehold(getPrisma(), userIdOf(req)));
});

householdRouter.post(
  '/household',
  validateBody(HouseholdCreateRequest),
  async (req: Request, res: Response) => {
    sendJson(res, 201, HouseholdResponse, await createHousehold(getPrisma(), userIdOf(req)));
  },
);

householdRouter.delete('/household', async (req: Request, res: Response) => {
  await deleteHousehold(getPrisma(), userIdOf(req));
  res.status(204).end();
});

householdRouter.post(
  '/household/invite',
  validateBody(HouseholdInviteRequest),
  async (req: Request, res: Response) => {
    sendJson(res, 201, HouseholdInviteResponse, await createInvite(getPrisma(), userIdOf(req)));
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
    await leaveHousehold(getPrisma(), userIdOf(req));
    res.status(204).end();
  },
);

householdRouter.delete('/household/members/:memberId', async (req: Request, res: Response) => {
  const parsed = Uuid.safeParse(req.params.memberId);
  if (!parsed.success) throw problems.notFound('No such member.');
  await removeMember(getPrisma(), userIdOf(req), parsed.data);
  res.status(204).end();
});
