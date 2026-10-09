import { disconnectPrisma } from '../db/client.ts';
import { logger } from '../logger.ts';
import { pruneAllTombstones } from '../services/tombstoneService.ts';
import { TOMBSTONE_HORIZON_DAYS } from '../sync/resolver.ts';

/**
 * `pnpm prune:tombstones` — delete tombstones past the 90-day horizon.
 *
 * Meant for a scheduler (cron, a platform scheduled job), not a request path: see the
 * doc comment on `services/tombstoneService.ts` for why `GET /v1/sync` must stay a read.
 * Safe to run as often as you like and safe to miss — the only consequence of a skipped
 * run is that tombstones live a little longer, and the `resyncRequired` watermark only
 * ever moves when a prune actually deletes something.
 */
async function main(): Promise<void> {
  const started = Date.now();
  const result = await pruneAllTombstones();
  logger.info('prune:tombstones finished', {
    horizonDays: TOMBSTONE_HORIZON_DAYS,
    ...result,
    ms: Date.now() - started,
  });
}

try {
  await main();
} catch (error) {
  logger.error('prune:tombstones failed', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
} finally {
  await disconnectPrisma();
}
