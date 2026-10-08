import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { databaseNameFromUrl, resolveDatabaseUrl } from './db/databaseUrl.ts';
import { loadBackendEnv } from './loadEnv.ts';

/**
 * Process configuration, parsed once at startup.
 *
 * Everything the server needs from the environment is validated here and nowhere else,
 * so a missing or malformed variable is a startup failure with a readable message rather
 * than a surprise `undefined` in a request handler at 3am.
 */

/** See `loadEnv.ts` for why `.env` overrides the shell, and why `NODE_ENV` does not. */
loadBackendEnv();

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Read the package version at startup, for `GET /v1/health`. */
function packageVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const parsed = z.object({ version: z.string() }).safeParse(pkg);
  return parsed.success ? parsed.data.version : '0.0.0';
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().min(0).max(65535).default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see .env.example)'),

  /**
   * Used only when `NODE_ENV=test`. Defaults to `DATABASE_URL` with `_test` appended to
   * the database name; either way the name must end in `_test`, because the suite
   * truncates every table between tests. See `src/db/databaseUrl.ts`.
   */
  TEST_DATABASE_URL: z.string().optional(),

  /**
   * HS256 signing key for access tokens. 32 characters is the floor because the key is
   * the only thing standing between a guess and an arbitrary `userId`.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /** 1 hour, per `docs/api/openapi.yaml`. Overridable so tests can mint expired tokens. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).default(3600),

  /**
   * 60 days, per the contract. Long on purpose: an offline-first app must not log the
   * user out because the device was offline for a week.
   */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(60),

  LOG_FORMAT: z.enum(['pretty', 'json', 'silent']).optional(),
});

function build() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  const isTest = env.NODE_ENV === 'test';
  const isProduction = env.NODE_ENV === 'production';

  // Under NODE_ENV=test this is not DATABASE_URL: the suite gets its own database and
  // refuses to run against one not named like a test database.
  const databaseUrl = resolveDatabaseUrl(process.env);

  return {
    env: env.NODE_ENV,
    isTest,
    isProduction,
    port: env.PORT,
    version: packageVersion(),
    databaseUrl,
    databaseName: databaseNameFromUrl(databaseUrl),
    jwt: {
      secret: env.JWT_SECRET,
      /** Pinned so a token minted for another service cannot be replayed here. */
      issuer: 'expense-tracker',
      audience: 'expense-tracker-api',
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    },
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    logFormat: env.LOG_FORMAT ?? (isTest ? 'silent' : isProduction ? 'json' : 'pretty'),
    /**
     * Whether to re-validate every response body against the `shared/` schema before
     * sending it. On outside production this is the cheapest possible guard against the
     * server and the contract drifting apart: a handler that forgets a field fails its
     * own test rather than a mobile build a week later.
     */
    validateResponses: !isProduction,
  } as const;
}

export type Config = ReturnType<typeof build>;

let cached: Config | undefined;

/** The parsed config. Lazy so that importing a module cannot fail on a bad environment. */
export function getConfig(): Config {
  cached ??= build();
  return cached;
}

/** Test-only: drop the cache so a test can re-parse after changing `process.env`. */
export function resetConfigForTests(): void {
  cached = undefined;
}
