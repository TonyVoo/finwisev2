import { defineConfig } from 'vitest/config';

/**
 * Backend test configuration.
 *
 * `NODE_ENV=test` is what points the app at its own database: `src/db/databaseUrl.ts`
 * resolves `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test` appended, and refuses a
 * database not named like a test database. The suite truncates every table between
 * tests, so that refusal is the thing standing between a mistyped env var and someone's
 * development data.
 */
// Set here, at config-evaluation time, rather than relying on vitest's own default:
// `globalSetup` and the app's config are both loaded after this file, and both need it.
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],

    /**
     * One file at a time. Every test file shares the single Postgres test database and
     * truncates it between tests, so running two in parallel means one file wiping
     * another's rows mid-assertion. Isolating by schema-per-worker would buy back the
     * parallelism; at this suite's size it would buy complexity instead.
     */
    fileParallelism: false,

    /**
     * argon2id is deliberately ~50ms per hash and the suite signs up real users, so a
     * file doing several logins can legitimately exceed the 5s default on a cold cache.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
