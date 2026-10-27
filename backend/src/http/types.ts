import type { Request } from 'express';

/**
 * Request-scoped state the middleware attaches.
 *
 * `userId` deliberately comes from nowhere but the verified access token. No request
 * body, query parameter or path segment in this API carries a `userId`, so an endpoint
 * cannot be pointed at another user's data — see `docs/PLAN.md` §3 (Tenancy).
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id, echoed to the client as `X-Request-Id`. Always set. */
      requestId?: string;
      /** Set only by `requireAuth`. Absent on public routes. */
      userId?: string;
      /**
       * Whose rows the request reads and writes: the caller's own id, or - while they are in a
       * household - the household owner's. Set only by `requireAuth`, from the database, never
       * from the request.
       */
      dataOwnerId?: string;
    }
  }
}

/** A request that has passed through `requireAuth`, so `userId` is known to be present. */
export interface AuthedRequest extends Request {
  userId: string;
}

/**
 * Read the authenticated user id. Throws rather than returning `undefined`, so a route
 * wired up without `requireAuth` fails loudly in tests instead of quietly querying
 * across tenants.
 */
export function userIdOf(req: Request): string {
  const { userId } = req;
  if (!userId) {
    throw new Error(
      'userIdOf() called on a request that did not pass requireAuth - route is mis-wired',
    );
  }
  return userId;
}

/**
 * The id every data row of this request is scoped by. Differs from {@link userIdOf} only for a
 * household member, whose identity is their own but whose books are the owner's.
 */
export function dataOwnerIdOf(req: Request): string {
  const { dataOwnerId } = req;
  if (!dataOwnerId) {
    throw new Error(
      'dataOwnerIdOf() called on a request that did not pass requireAuth - route is mis-wired',
    );
  }
  return dataOwnerId;
}
