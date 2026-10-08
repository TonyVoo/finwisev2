import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { getConfig } from '../src/config.ts';
import { databaseNameFromUrl, maintenanceUrl } from '../src/db/databaseUrl.ts';
import { PrismaClient } from '../src/db/generated/client.ts';

/**
 * Create the test database if it does not exist, then bring it up to date.
 *
 * Runs once per `vitest` invocation, before any test file. Migrations are *applied*,
 * never `db push`ed: the point of the suite is to exercise the schema that ships, and
 * the checked-in migration is that schema — including the CHECK constraints, partial
 * indexes and the `next_revision()` function, none of which Prisma's schema language
 * can express and so none of which a `db push` would create.
 */

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const name = databaseNameFromUrl(databaseUrl);

  // `CREATE DATABASE` cannot run from inside the database being created, so this talks
  // to the server's `postgres` maintenance database instead.
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: maintenanceUrl(databaseUrl) }),
  });

  try {
    // Checked rather than create-and-swallow-the-error: Prisma wraps the driver's
    // `42P04` in its own message, so matching on it would mean parsing error prose that
    // changes between versions.
    const existing = await admin.$queryRaw<{ one: number }[]>`
      SELECT 1 AS "one" FROM "pg_database" WHERE "datname" = ${name}
    `;
    if (existing.length > 0) return;

    // Not parameterisable: `CREATE DATABASE` takes an identifier, not a value. The name
    // comes from our own env var, and embedded quotes are escaped.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    console.log(`[test] created database "${name}"`);
  } catch (error) {
    throw new Error(
      `Could not prepare the test database "${name}". Is Postgres running and reachable ` +
        `with the credentials in backend/.env? Original error: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  } finally {
    await admin.$disconnect();
  }
}

export default async function setup(): Promise<void> {
  // `getConfig()` already applied the test-database rules; read the target from it
  // rather than re-deriving, so the suite and the app cannot disagree.
  const { databaseUrl, databaseName, env } = getConfig();

  if (env !== 'test') {
    // The rules that keep the suite off a real database key off `NODE_ENV=test`. If it
    // is not set, stop — do not truncate whatever this happens to be pointed at.
    throw new Error(`Expected NODE_ENV=test for the test suite, got "${env}".`);
  }

  await createDatabaseIfMissing(databaseUrl);

  // The CLI resolves the same URL through `prisma.config.ts`, which calls
  // `resolveDatabaseUrl` too — so `NODE_ENV=test` is all it takes to aim it here.
  execFileSync('prisma', ['migrate', 'deploy'], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  console.log(`[test] database "${databaseName}" is migrated`);
}
