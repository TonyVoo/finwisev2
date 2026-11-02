import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../auth/accessToken.ts';
import { getPrisma } from '../db/client.ts';
import { ApiProblem, problems } from '../errors.ts';

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

/**
 * Which book a request works in: `X-Space-Id`, validated every time (`docs/design/13-multiple-households.md`).
 *
 * Stateless on purpose: nothing remembers "which space this person is in", so two devices of one account can be
 * in different ones and a retried request cannot land in the wrong book. The value must be the caller's own
 * account id or the book of a household they belong to; anything else - another person's, one that does not
 * exist, one that is not even an id - is the same `404 not_found`, so spaces cannot be probed. With no header,
 * a person in exactly one household works in it (an older app, which never sends one, is unaffected) and
 * anyone else works in their own.
 */
function resolveSpace(
  header: string | undefined,
  userId: string,
  householdScopes: readonly string[],
): string {
  if (header === undefined) return householdScopes.length === 1 ? householdScopes[0]! : userId;
  const requested = header.trim().toLowerCase();
  if (requested === userId || householdScopes.includes(requested)) return requested;
  // `details` lets a device tell this from any other 404 and fall back to its personal space; it never
  // repeats the value asked for.
  throw new ApiProblem('not_found', 'No such space.', { header: 'X-Space-Id' });
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
          disabledAt: true,
          // The books the person may work in, found in the same lookup (`docs/design/13-multiple-households.md`).
          householdMemberships: { select: { household: { select: { scopeId: true } } } },
        },
      });
      if (account === null) {
        throw problems.tokenInvalid('Access token does not belong to an existing account.');
      }
      // An operator disabled the account: its tokens stop working at once, not when they expire.
      if (account.disabledAt !== null) {
        throw problems.tokenInvalid('Access token does not belong to an active account.');
      }
      req.userId = userId;
      req.dataOwnerId = resolveSpace(
        req.get('X-Space-Id'),
        userId,
        account.householdMemberships.map((membership) => membership.household.scopeId),
      );
      next();
    })
    .catch(next);
};
