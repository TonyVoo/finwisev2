import { Uuid } from '@expense-tracker/shared';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrisma } from '../db/client.ts';
import { problems } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import { userIdOf } from '../http/types.ts';
import { validateBody, validatedQuery, validateQuery } from '../middleware/validate.ts';
import { deleteUser, listUsers, overview, setDisabled } from './adminService.ts';
import { requireAdmin } from './requireAdmin.ts';
import {
  AdminDeleteRequest,
  AdminMeResponse,
  AdminOverview,
  AdminUserList,
  AdminUserResponse,
  AdminUsersQuery,
} from './schemas.ts';

/**
 * The admin page and its API (`docs/design/17-admin.md`).
 *
 * The page is three static files with no data in them, so it is served without signing in; everything it shows
 * comes from `/admin/api`, which needs a valid token and an address in `ADMIN_EMAILS`.
 */

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'web');

/** No inline script, no framing, nothing fetched from outside: the page only talks to this server. */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function serveFile(file: string, contentType: string): RequestHandler {
  let cached: string | undefined;
  return (_req: Request, res: Response) => {
    cached ??= readFileSync(join(WEB_DIR, file), 'utf8');
    res
      .set({
        'Content-Type': contentType,
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      })
      .send(cached);
  };
}

/** The page: public, and exactly these three paths. */
export const adminPageRouter = Router();
adminPageRouter.get(['/admin', '/admin/'], serveFile('index.html', 'text/html; charset=utf-8'));
adminPageRouter.get('/admin/admin.js', serveFile('admin.js', 'text/javascript; charset=utf-8'));
adminPageRouter.get('/admin/admin.css', serveFile('admin.css', 'text/css; charset=utf-8'));

/** The API: mounted behind `requireAuth` and `requireAdmin` (`app.ts`). */
export const adminApiRouter = Router();
adminApiRouter.use(requireAdmin);

/** An id in a path, or the one `404` for anything that is not an account's. */
function targetOf(req: Request): string {
  const parsed = Uuid.safeParse(req.params.id);
  if (!parsed.success) throw problems.notFound('No such account.');
  return parsed.data;
}

adminApiRouter.get('/me', async (req: Request, res: Response) => {
  const user = await getPrisma().user.findUniqueOrThrow({
    where: { id: userIdOf(req) },
    select: { email: true },
  });
  sendJson(res, 200, AdminMeResponse, { email: user.email });
});

adminApiRouter.get('/overview', async (_req: Request, res: Response) => {
  sendJson(res, 200, AdminOverview, await overview(getPrisma()));
});

adminApiRouter.get('/users', validateQuery(AdminUsersQuery), async (_req, res: Response) => {
  sendJson(
    res,
    200,
    AdminUserList,
    await listUsers(getPrisma(), validatedQuery(res, AdminUsersQuery)),
  );
});

adminApiRouter.post('/users/:id/disable', async (req: Request, res: Response) => {
  const user = await setDisabled(getPrisma(), userIdOf(req), targetOf(req), true);
  sendJson(res, 200, AdminUserResponse, { user });
});

adminApiRouter.post('/users/:id/enable', async (req: Request, res: Response) => {
  const user = await setDisabled(getPrisma(), userIdOf(req), targetOf(req), false);
  sendJson(res, 200, AdminUserResponse, { user });
});

adminApiRouter.delete(
  '/users/:id',
  validateBody(AdminDeleteRequest),
  async (req: Request, res: Response) => {
    const body = req.body as AdminDeleteRequest;
    await deleteUser(getPrisma(), userIdOf(req), targetOf(req), body.email);
    res.status(204).end();
  },
);
