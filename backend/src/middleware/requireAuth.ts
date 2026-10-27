import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../auth/accessToken.ts';
import { getPrisma } from '../db/client.ts';
import { problems } from '../errors.ts';

/**
 * Gate for every authenticated route.
 *
 * This is the only thing that ever sets `req.userId` and `req.dataOwnerId`, and the token is the only place it
 * comes from — see `docs/PLAN.md` §3 (Tenancy). No request body, query parameter or path
 * segment in this API carries a `userId`, so there is no way to point an endpoint at
 * another user's rows.
 *
 * Mounted on the router that owns the data routes rather than per-handler, so a route
 * added later is authenticated by default. Forgetting it is still caught: `userIdOf()`
 * throws rather than returning `undefined`, so a mis-wired route fails its test instead
 * of quietly querying across tenants.
 */

/** `Authorization: Bearer <token>`, case-insensitive scheme, exactly one space. */
const BEARER = /^Bearer (.+)$/i;

function extractBearerToken(req: Request): string | undefined {
  const header = req.get('Authorization');
  if (header === undefined) return undefined;
  const match = BEARER.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

export const requireAuth: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const token = extractBearerToken(req);

  // No credentials at all is `unauthorized`; credentials that do not hold up are
  // `token_expired` / `token_invalid`. The client branches on exactly this: refresh and
  // retry, versus send the user back to the login screen.
  if (token === undefined) {
    next(problems.unauthorized('Authorization header must be "Bearer <accessToken>".'));
    return;
  }

  verifyAccessToken(token)
    .then(async (userId) => {
      // A signature that verifies proves the token was minted for this user, not that the
      // user still exists. Access tokens are stateless, so one outlives `DELETE /v1/me` by
      // up to an hour - and without this check a second signed-in device would spend that
      // hour getting `500`s from foreign-key violations on every push, instead of being
      // told once, correctly, that its session is gone. One primary-key lookup, and the
      // answer is the same `token_invalid` that `GET /v1/me` has always given.
      const account = await getPrisma().user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          // The data scope, found in the same lookup: a household member reads and writes
          // the owner's rows, everyone else their own.
          householdMember: { select: { household: { select: { ownerId: true } } } },
        },
      });
      if (account === null) {
        throw problems.tokenInvalid('Access token does not belong to an existing account.');
      }
      req.userId = userId;
      req.dataOwnerId = account.householdMember?.household.ownerId ?? userId;
      next();
    })
    .catch(next);
};
