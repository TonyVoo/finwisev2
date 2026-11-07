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

  /**
   * Outgoing email, for password-reset codes. Both or neither: with both set, codes are sent
   * through Resend (https://resend.com); with neither, the code is written to the server log
   * outside production - which is all local development needs - and in production nothing is
   * sent and a warning says so. `MAIL_FROM` must be an address on a domain verified with the
   * provider, e.g. `Expense Tracker <no-reply@yourdomain.com>`.
   */
  RESEND_API_KEY: z.string().min(1).optional(),

  /**
   * Reading receipts (`POST /v1/receipts/scan`) with OCR.space, which has a free plan (a free API
   * key, no card). Preferred over Google Vision when both are set. Same opt-in as below: unset,
   * and with no Vision key either, the endpoint answers `503 ocr_unavailable`.
   */
  OCR_SPACE_API_KEY: z.string().min(1).optional(),

  /**
   * Reading receipts (`POST /v1/receipts/scan`): a Google Cloud Vision API key. Unset, the
   * endpoint answers `503 ocr_unavailable` and the app stops offering it; nothing else
   * depends on it. The photo is sent to Google when this is set, which is why it is opt-in.
   */
  GOOGLE_VISION_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),

  /**
   * The market-data service (`vn-stock-assistant`'s `api/`, uvicorn), behind the Investing tab.
   * Unset, `/v1/market/*` answers `503 market_unavailable` and nothing else is affected. The key
   * is sent as `X-Api-Key`; it must match the service's `MARKET_API_KEY`.
   */
  MARKET_API_URL: z.url().optional(),
  MARKET_API_KEY: z.string().min(1).optional(),

  /**
   * Reading receipts with a vision model (Google Gemini; `docs/design/14-ai-receipt-reading.md`),
   * tried before OCR when a key is set. Free-tier requests may be used by Google to improve its
   * products, which is why this is opt-in and disclosed in the app. `GEMINI_MODEL` is config
   * because Google retires model names; `GEMINI_DAILY_BUDGET` caps calls per Pacific day, kept under
   * the free quota so a busy day falls back to OCR instead of failing.
   */
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_DAILY_BUDGET: z.coerce.number().int().min(0).default(500),
  /**
   * Calls per Pacific day for reading typed sentences (quick add, `docs/design/15-quick-add.md`),
   * counted apart from the receipt budget so one cannot use up the other's share of the free quota.
   */
  GEMINI_QUICK_ADD_DAILY_BUDGET: z.coerce.number().int().min(0).default(200),
  /**
   * Calls per Pacific day for writing a month's recap (`docs/design/16-monthly-insights.md`), counted apart
   * from the other two Gemini features so none of them can use up another's share of the free quota.
   */
  GEMINI_RECAP_DAILY_BUDGET: z.coerce.number().int().min(0).default(100),

  /**
   * Accounts that may open the admin page (`docs/design/17-admin.md`): comma-separated emails, compared
   * trimmed and lowercased. Unset or empty, nobody can, and the admin routes answer 404 to everyone.
   */
  ADMIN_EMAILS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email !== ''),
    ),

  /**
   * How many reverse proxies sit in front of this process, or `false` for none.
   *
   * This is a rate-limiting setting, not a cosmetic one. `req.ip` is the socket's remote
   * address unless Express is told to trust `X-Forwarded-For`, so behind a load balancer
   * an untrusting server sees every request as coming from the balancer — and the
   * per-source-address login bucket collapses into a single global budget shared by
   * every user on the planet. That is not a weak limiter, it is an outage.
   *
   * The inverse mistake is worse, which is why the default is `false` and the value is a
   * *count* rather than a boolean: trusting a header nobody is stripping lets a caller
   * set their own `X-Forwarded-For` and mint a fresh bucket per guess. Set this to the
   * number of proxies you actually run, so Express takes the Nth-from-last entry — the
   * one your own proxy wrote — and ignores whatever the client put in front of it.
   */
  TRUST_PROXY: z
    .union([z.literal('false'), z.coerce.number().int().min(0)])
    .default('false')
    .transform((value) => (value === 'false' ? false : value)),
});

/** A signing key that is obviously not random: a placeholder word, or too few distinct characters. */
function isPlaceholderSecret(secret: string): boolean {
  return (
    /change-?me|dev-only|insecure|placeholder|example/i.test(secret) || new Set(secret).size < 10
  );
}

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

  // A copied `.env.example` is the likeliest way to ship the development key. Anyone who has seen the repository
  // can then sign a token for any account, so production refuses it rather than running quietly.
  if (isProduction && isPlaceholderSecret(env.JWT_SECRET)) {
    throw new Error(
      'Invalid environment:\n  - JWT_SECRET: looks like a placeholder; generate one with ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
    );
  }

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
    /** Who may open the admin page. See `ADMIN_EMAILS` above. */
    adminEmails: env.ADMIN_EMAILS,
    mail: { resendApiKey: env.RESEND_API_KEY, from: env.MAIL_FROM },
    ocr: {
      ocrSpaceApiKey: env.OCR_SPACE_API_KEY,
      googleVisionApiKey: env.GOOGLE_VISION_API_KEY,
    },
    market: { url: env.MARKET_API_URL, apiKey: env.MARKET_API_KEY },
    vision: {
      geminiApiKey: env.GEMINI_API_KEY,
      geminiModel: env.GEMINI_MODEL,
      geminiDailyBudget: env.GEMINI_DAILY_BUDGET,
      geminiQuickAddDailyBudget: env.GEMINI_QUICK_ADD_DAILY_BUDGET,
      geminiRecapDailyBudget: env.GEMINI_RECAP_DAILY_BUDGET,
    },
    /** Express's `trust proxy` setting. See `TRUST_PROXY` above for why it matters. */
    trustProxy: env.TRUST_PROXY,
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
