import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router, type Request, type Response } from 'express';

/**
 * `GET /docs` - Swagger UI over `docs/api/openapi.yaml`, for people poking at the API.
 *
 * Mounted only outside production (`app.ts`): the contract is not a secret, but a public
 * "try it out" console on a live API is an invitation the service has no reason to make.
 *
 * No new dependency. The spec is served as the raw file - the same one the contract tests
 * hold equal to the zod schemas, so these docs cannot drift from what the server accepts -
 * and the UI is the pinned Swagger UI bundle from a CDN, which means the *browser* needs
 * internet to render it; the API itself does not.
 */

const SPEC_URL = new URL('../../../docs/api/openapi.yaml', import.meta.url);
const SWAGGER_UI_VERSION = '5.17.14';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Expense Tracker API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.yaml',
        dom_id: '#swagger-ui',
        persistAuthorization: true,
      });
    </script>
  </body>
</html>
`;

export const docsRouter = Router();

docsRouter.get('/docs', (_req: Request, res: Response) => {
  res.type('html').send(PAGE);
});

docsRouter.get('/docs/openapi.yaml', async (_req: Request, res: Response) => {
  // Read per request rather than at import, so editing the spec shows on refresh in dev.
  const spec = await readFile(fileURLToPath(SPEC_URL), 'utf8');
  res.type('application/yaml').send(spec);
});
