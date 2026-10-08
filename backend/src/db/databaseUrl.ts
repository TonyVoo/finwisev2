/**
 * Which Postgres database this process talks to.
 *
 * Shared by `src/config.ts` (the app) and `prisma.config.ts` (the CLI), because the app
 * and its migrations disagreeing about the target is a whole class of confusing bug:
 * you migrate, the server still 500s, and the schema you changed is in another database.
 *
 * The interesting case is `NODE_ENV=test`. The suite truncates every table between
 * tests, so pointing it at a database with real rows in it destroys them. Hence the
 * two rules below: tests use their own database, and that database has to be named like
 * one.
 */

/** Suffix every test database name must carry. See {@link resolveDatabaseUrl}. */
const TEST_DATABASE_SUFFIX = '_test';

function databaseNameOf(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

/** Same server, same credentials, different database. */
function withDatabaseName(url: URL, name: string): URL {
  const next = new URL(url.href);
  next.pathname = `/${encodeURIComponent(name)}`;
  return next;
}

function parse(raw: string, variable: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${variable} is not a valid connection URL (got "${raw}").`);
  }
}

/**
 * Pick the connection string for the current environment.
 *
 * Outside tests this is just `DATABASE_URL`. Under `NODE_ENV=test` it is
 * `TEST_DATABASE_URL` if set, otherwise `DATABASE_URL` with `_test` appended to the
 * database name — so the common case needs no extra configuration and still cannot
 * touch the development database.
 *
 * The `_test` suffix is then *required*, not merely conventional. A `TEST_DATABASE_URL`
 * aimed at a database that matters is the one configuration mistake in this file that
 * silently deletes data, so it is a startup failure instead.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const raw = env.DATABASE_URL;
  if (raw === undefined || raw === '') {
    throw new Error('DATABASE_URL is required (see backend/.env.example).');
  }
  if (env.NODE_ENV !== 'test') return raw;

  const configured = env.TEST_DATABASE_URL;
  const url =
    configured !== undefined && configured !== ''
      ? parse(configured, 'TEST_DATABASE_URL')
      : withDatabaseName(
          parse(raw, 'DATABASE_URL'),
          `${databaseNameOf(parse(raw, 'DATABASE_URL'))}${TEST_DATABASE_SUFFIX}`,
        );

  const name = databaseNameOf(url);
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run the test suite against database "${name}": the suite truncates ` +
        `every table between tests. Point TEST_DATABASE_URL at a database whose name ends ` +
        `in "${TEST_DATABASE_SUFFIX}".`,
    );
  }
  return url.href;
}

/**
 * The same server's `postgres` maintenance database.
 *
 * `CREATE DATABASE` cannot run from inside the database being created, so the test
 * bootstrap connects here to create the test database on first run.
 */
export function maintenanceUrl(databaseUrl: string): string {
  return withDatabaseName(parse(databaseUrl, 'DATABASE_URL'), 'postgres').href;
}

/** The database a connection string points at, for log and error messages. */
export function databaseNameFromUrl(databaseUrl: string): string {
  return databaseNameOf(parse(databaseUrl, 'DATABASE_URL'));
}
