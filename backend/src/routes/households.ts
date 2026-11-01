import {
  HouseholdInviteRequest,
  HouseholdInviteResponse,
  HouseholdLeaveRequest,
  HouseholdListResponse,
  HouseholdRenameRequest,
  HouseholdResponse,
  HouseholdTransferRequest,
  Uuid,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { problems } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import { userIdOf } from '../http/types.ts';
import { validateBody } from '../middleware/validate.ts';
import {
  createInvite,
  deleteHousehold,
  leaveHousehold,
  listHouseholds,
  removeMember,
  renameHousehold,
  transferHousehold,
} from '../services/householdService.ts';

/**
 * `/v1/households` - households addressed by id (`docs/design/13-multiple-households.md`).
 *
 * A person may be in several, so the household is named in the path. Membership is identity, so every handler
 * uses `userIdOf` (who the caller *is*) and ignores `X-Space-Id`. An id that is malformed, unknown or not the
 * caller's is the same `404`, so ids cannot be probed.
 */
export const householdsRouter = Router();

/** The `{householdId}` of a route, or the one `404` for anything that is not an id. */
function householdIdOf(req: Request): string {
  const parsed = Uuid.safeParse(req.params.householdId);
  if (!parsed.success) throw problems.notFound('No such household.');
  return parsed.data;
}

householdsRouter.get('/households', async (req: Request, res: Response) => {
  sendJson(res, 200, HouseholdListResponse, await listHouseholds(getPrisma(), userIdOf(req)));
});

householdsRouter.patch(
  '/households/:householdId',
  validateBody(HouseholdRenameRequest),
  async (req: Request, res: Response) => {
    const body = req.body as HouseholdRenameRequest;
    sendJson(
      res,
      200,
      HouseholdResponse,
      await renameHousehold(getPrisma(), userIdOf(req), householdIdOf(req), body.name),
    );
  },
);

householdsRouter.delete('/households/:householdId', async (req: Request, res: Response) => {
  await deleteHousehold(getPrisma(), userIdOf(req), householdIdOf(req));
  res.status(204).end();
});

householdsRouter.post(
  '/households/:householdId/invite',
  validateBody(HouseholdInviteRequest),
  async (req: Request, res: Response) => {
    sendJson(
      res,
      201,
      HouseholdInviteResponse,
      await createInvite(getPrisma(), userIdOf(req), householdIdOf(req)),
    );
  },
);

householdsRouter.post(
  '/households/:householdId/leave',
  validateBody(HouseholdLeaveRequest),
  async (req: Request, res: Response) => {
    await leaveHousehold(getPrisma(), userIdOf(req), householdIdOf(req));
    res.status(204).end();
  },
);

householdsRouter.post(
  '/households/:householdId/transfer',
  validateBody(HouseholdTransferRequest),
  async (req: Request, res: Response) => {
    const body = req.body as HouseholdTransferRequest;
    sendJson(
      res,
      200,
      HouseholdResponse,
      await transferHousehold(getPrisma(), userIdOf(req), householdIdOf(req), body.memberId),
    );
  },
);

householdsRouter.delete(
  '/households/:householdId/members/:memberId',
  async (req: Request, res: Response) => {
    const householdId = householdIdOf(req);
    const member = Uuid.safeParse(req.params.memberId);
    // The household is checked first, so a stranger learns nothing from the member id; one that is not an
    // id is a member who is not there (the nil id matches no one).
    await removeMember(
      getPrisma(),
      userIdOf(req),
      householdId,
      member.success ? member.data : '00000000-0000-0000-0000-000000000000',
    );
    res.status(204).end();
  },
);
