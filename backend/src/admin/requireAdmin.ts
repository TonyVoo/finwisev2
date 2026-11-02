import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getConfig } from '../config.ts';
import { getPrisma } from '../db/client.ts';
import { problems } from '../errors.ts';

/**
 * Lets only the accounts listed in `ADMIN_EMAILS` through (`docs/design/17-admin.md`). Runs after
 * `requireAuth`, so the caller is a real, enabled account; everyone not on the list gets the same `404` as for
 * a path that does not exist, so the page's routes cannot be told apart from nothing.
 */
export const requireAdmin: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const admins = getConfig().adminEmails;
  if (admins.length === 0 || req.userId === undefined) {
    next(problems.notFound());
    return;
  }
  getPrisma()
    .user.findUnique({ where: { id: req.userId }, select: { email: true } })
    .then((user) => {
      if (user === null || !admins.includes(user.email.toLowerCase())) throw problems.notFound();
      next();
    })
    .catch(next);
};

/** Whether an email is one of the admins, for marking them in the list and protecting them. */
export function isAdminEmail(email: string): boolean {
  return getConfig().adminEmails.includes(email.toLowerCase());
}
