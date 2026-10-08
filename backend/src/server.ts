import type { Server } from 'node:http';
import { createApp } from './app.ts';
import { getConfig } from './config.ts';
import { disconnectPrisma } from './db/client.ts';
import { logger } from './logger.ts';

/**
 * Process entry point: `pnpm dev` / `pnpm start`.
 *
 * Kept separate from `app.ts` so that constructing the app never binds a port — the test
 * suite builds the app hundreds of times and must not fight over 3000.
 */

const config = getConfig();
const server: Server = createApp().listen(config.port, () => {
  logger.info('listening', {
    port: config.port,
    env: config.env,
    version: config.version,
    database: config.databaseName,
  });
});

/**
 * Shut down on a signal without dropping in-flight requests.
 *
 * `server.close` stops accepting connections and waits for open ones to finish, then the
 * pool is closed. The timer is the backstop: a hung request must not keep a container
 * alive past its termination grace period, or the orchestrator kills it mid-write
 * instead.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });

  const forced = setTimeout(() => {
    logger.error('shutdown timed out, exiting', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectPrisma();
  logger.info('stopped');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

/**
 * A rejection nobody handled means some state is now unknown. Log it and let the
 * supervisor restart the process rather than serving requests from here on.
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});
