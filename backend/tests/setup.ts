import { afterAll, beforeEach } from 'vitest';
import { disconnectPrisma } from '../src/db/client.ts';
import { resetLoginRateLimitForTests } from '../src/middleware/loginRateLimit.ts';
import { resetPasswordResetRateLimitForTests } from '../src/middleware/passwordResetRateLimit.ts';
import { resetPasswordConfirmRateLimitForTests } from '../src/middleware/passwordConfirmRateLimit.ts';
import { truncateAll } from './support/db.ts';

/**
 * Per-file test setup.
 *
 * Wiping *before* each test rather than after means a failing test leaves its rows in
 * the database to be inspected, and a crashed run does not poison the next one.
 */
beforeEach(async () => {
  await truncateAll();
  /**
   * The login limiter's counts live in the process, not the database, so `truncateAll`
   * does not touch them — and `tests/support/api.ts` builds one app per file, which
   * every test in that file shares. Without this, a test that fails ten logins would
   * leave the next one looking at a `429` from somebody else's failures, and the suite
   * would be order-dependent in a way that only shows up when a file grows.
   */
  resetLoginRateLimitForTests();
  resetPasswordConfirmRateLimitForTests();
  resetPasswordResetRateLimitForTests();
});

// Without this the pool keeps the worker's event loop alive and vitest hangs on exit.
afterAll(async () => {
  await disconnectPrisma();
});
