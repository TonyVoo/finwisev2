import { config as loadDotenv } from 'dotenv';

/**
 * Load `backend/.env`, once, for both the app and the Prisma CLI.
 *
 * Two deliberate choices here, and they pull in opposite directions:
 *
 * `override: true` — in a pnpm workspace a shell may already export a `DATABASE_URL`
 * for some other project. The `.env` sitting next to this package is the unambiguous
 * statement of which database *this* app talks to, and `prisma.config.ts` loads it the
 * same way, so the app and its migrations can never disagree about the target.
 *
 * ...except for `NODE_ENV`, which is restored afterwards if the process already had one.
 * `NODE_ENV` is not a connection setting: it says what the process *is*, and that is
 * decided by how it was started (`vitest`, `NODE_ENV=production node`), never by a file
 * on disk. Letting `.env` win here is how `pnpm test` ends up running in `development`
 * mode — which, because the test-database rules in `src/db/databaseUrl.ts` key off
 * `NODE_ENV=test`, is how a truncating test suite ends up pointed at the development
 * database.
 */
export function loadBackendEnv(): void {
  const nodeEnvFromProcess = process.env.NODE_ENV;
  loadDotenv({ override: true, quiet: true });
  if (nodeEnvFromProcess !== undefined && nodeEnvFromProcess !== '') {
    process.env.NODE_ENV = nodeEnvFromProcess;
  }
}
