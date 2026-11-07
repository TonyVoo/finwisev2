import { afterAll, beforeEach } from 'vitest';
import { disconnectPrisma } from '../src/db/client.ts';
import { resetLoginRateLimitForTests } from '../src/middleware/loginRateLimit.ts';
import { resetEmailVerificationRateLimitForTests } from '../src/middleware/emailVerificationRateLimit.ts';
import { resetPasswordResetRateLimitForTests } from '../src/middleware/passwordResetRateLimit.ts';
import { resetHouseholdJoinRateLimitForTests } from '../src/middleware/householdJoinRateLimit.ts';
import { resetReceiptScanRateLimitForTests } from '../src/middleware/receiptScanRateLimit.ts';
import { resetPasswordConfirmRateLimitForTests } from '../src/middleware/passwordConfirmRateLimit.ts';
import { resetAssistantRateLimitForTests } from '../src/middleware/assistantRateLimit.ts';
import { resetQuickAddRateLimitForTests } from '../src/middleware/quickAddRateLimit.ts';
import { setQuickAddReaderForTests } from '../src/services/quickAddReader.ts';
import { resetRecapRateLimitForTests } from '../src/middleware/recapRateLimit.ts';
import { setRecapReaderForTests } from '../src/services/recapReader.ts';
import { setReceiptReaderForTests } from '../src/services/receiptStrategies.ts';
import { setTextReaderForTests } from '../src/services/textReader.ts';
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
  resetEmailVerificationRateLimitForTests();
  resetHouseholdJoinRateLimitForTests();
  resetReceiptScanRateLimitForTests();
  resetQuickAddRateLimitForTests();
  resetAssistantRateLimitForTests();
  resetRecapRateLimitForTests();
  /**
   * Receipt readers come from `.env` (the config reads it even under test), so a developer who
   * has set real keys would otherwise have any test that forgot to fake a reader send its fake
   * photo to the real provider. Off by default; a test that wants one installs it.
   */
  setReceiptReaderForTests(null);
  setQuickAddReaderForTests(null);
  setRecapReaderForTests(null);
  setTextReaderForTests(null);
});

// Without this the pool keeps the worker's event loop alive and vitest hangs on exit.
afterAll(async () => {
  await disconnectPrisma();
});
