import { afterAll, beforeEach } from 'vitest';
import { disconnectPrisma } from '../src/db/client.ts';
import { truncateAll } from './support/db.ts';

/**
 * Per-file test setup.
 *
 * Wiping *before* each test rather than after means a failing test leaves its rows in
 * the database to be inspected, and a crashed run does not poison the next one.
 */
beforeEach(async () => {
  await truncateAll();
});

// Without this the pool keeps the worker's event loop alive and vitest hangs on exit.
afterAll(async () => {
  await disconnectPrisma();
});
