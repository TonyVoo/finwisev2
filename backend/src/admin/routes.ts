import { Uuid } from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
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
 * The page is a built React app (`admin/`) with no data in it, so it is served without signing in; everything it
 * shows comes from `/admin/api`, which needs a valid token and an address in `ADMIN_EMAILS`.
 */

/**
 * Where the built page is (`pnpm --filter @expense-tracker/admin build` writes it here). `ADMIN_WEB_DIR` is a
 * test seam; nothing else sets it.
 */
const webDir = (): string =>
  process.env.ADMIN_WEB_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin-dist');

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

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** A built file's name: letters, digits, dot, dash and underscore, so no path can climb out of the folder. */
const ASSET_NAME = /^[A-Za-z0-9._-]+$/;

function sendBuilt(res: Response, relative: string[]): void {
  const extension = extname(relative[relative.length - 1] ?? '');
  const type = CONTENT_TYPES[extension];
  const file = join(webDir(), ...relative);
  if (type === undefined || !existsSync(file)) {
    // Not built (or not a file we serve): the admin page is simply absent.
    res.status(relative[0] === 'index.html' ? 503 : 404);
    res
      .type('text/plain')
      .send(
        relative[0] === 'index.html'
          ? 'The admin page is not built. Run: pnpm --filter @expense-tracker/admin build'
          : 'Not found.',
      );
    return;
  }
  res
    .set({
      'Content-Type': type,
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    })
    .send(readFileSync(file));
}

/** The page: public, since it holds no data. The index and the built files under `/admin/assets`, nothing else. */
export const adminPageRouter = Router();
adminPageRouter.get(['/admin', '/admin/'], (_req: Request, res: Response) => {
  sendBuilt(res, ['index.html']);
});
adminPageRouter.get('/admin/assets/:name', (req: Request, res: Response) => {
  const name = String(req.params.name);
  if (!ASSET_NAME.test(name) || name.startsWith('.')) {
    res.status(404).type('text/plain').send('Not found.');
    return;
  }
  sendBuilt(res, ['assets', name]);
});

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
