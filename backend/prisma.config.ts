import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './src/db/databaseUrl.ts';
import { loadBackendEnv } from './src/loadEnv.ts';

/**
 * Prisma CLI configuration.
 *
 * The schema and its migrations live under `src/db/` rather than Prisma's default
 * `prisma/` directory, to match the repo layout in `docs/PLAN.md` §2.
 *
 * The environment is loaded exactly as the app loads it (`src/loadEnv.ts`), so a
 * migration cannot be applied to a different database than the server then reads.
 * Running a migration against the wrong database is not a mistake worth leaving
 * available.
 */
loadBackendEnv();

export default defineConfig({
  schema: 'src/db/schema.prisma',
  migrations: {
    path: 'src/db/migrations',
  },
  datasource: {
    // Same resolution the app uses, so `NODE_ENV=test prisma migrate deploy` migrates
    // the test database rather than the development one. The test bootstrap relies on
    // this; see `tests/globalSetup.ts`.
    url: resolveDatabaseUrl(process.env),
    // Only needed by `prisma migrate dev`, which diffs against a throwaway database.
    // `migrate deploy` (CI, production) does not use one.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
