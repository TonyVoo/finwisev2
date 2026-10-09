import express, { Router, type Express } from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { jsonBodyErrors, parseJsonBody, requireJsonContentType } from './middleware/jsonBody.ts';
import { requestId } from './middleware/requestId.ts';
import { requireAuth } from './middleware/requireAuth.ts';
import { authRouter } from './routes/auth.ts';
import { categoriesRouter } from './routes/categories.ts';
import { expensesRouter } from './routes/expenses.ts';
import { healthRouter } from './routes/health.ts';
import { meRouter } from './routes/me.ts';
import { syncRouter } from './routes/sync.ts';

/**
 * Build the Express app.
 *
 * A factory rather than a module-level singleton so the test suite can construct it
 * without starting a listener, and so nothing is created as a side effect of an import.
 *
 * The order below is the contract's error behaviour, expressed as middleware:
 *
 *  1. `requestId` first, before anything that can fail, so even a 415 or a 500 carries
 *     the `X-Request-Id` the contract tells clients to quote.
 *  2. Content-type and body parsing next, with `jsonBodyErrors` immediately after the
 *     parser — body-parser reports its own failures as generic errors, which would
 *     otherwise surface as `500 internal_error` for what is plainly a client mistake.
 *  3. Public routes, then the authenticated router, then the 404, then `errorHandler`
 *     last: it is the single place a non-2xx body is ever written.
 */
export function createApp(): Express {
  const app = express();

  // Nothing useful, and it advertises the stack to anyone scanning.
  app.disable('x-powered-by');

  // Express would otherwise 301 `/v1/me/` to `/v1/me`, turning a trailing-slash typo in
  // a client into a redirect the client has to follow instead of an honest 404.
  app.set('strict routing', false);

  app.use(requestId);
  app.use(requireJsonContentType);
  app.use(parseJsonBody);
  app.use(jsonBodyErrors);

  // Public: liveness and the credential endpoints.
  app.use('/v1', healthRouter);
  app.use('/v1', authRouter);

  /**
   * Everything else under `/v1` requires a valid access token.
   *
   * `requireAuth` is mounted on the router rather than listed per route, so a route
   * added in a later task is authenticated by default — the failure mode of a
   * per-handler list is that one handler is missing from it, and that handler serves
   * every user's rows to anyone. The data routes (`/v1/categories`, `/v1/expenses`,
   * `/v1/sync`) land on this router.
   *
   * One visible consequence: an unauthenticated request to a `/v1` path that does not
   * exist is `401`, not `404`. That is the right way round — answering 404 would confirm
   * which paths exist to a caller holding no credentials.
   */
  const authed = Router();
  authed.use(requireAuth);
  authed.use(meRouter);
  authed.use(categoriesRouter);
  authed.use(expensesRouter);
  authed.use(syncRouter);
  app.use('/v1', authed);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
