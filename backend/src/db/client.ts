import { PrismaPg } from '@prisma/adapter-pg';
import { getConfig } from '../config.ts';
import { PrismaClient } from './generated/client.ts';

/**
 * The Prisma client, built on the `pg` driver adapter (Prisma 7 has no Rust engine).
 *
 * One instance per process, created lazily so that importing a module never opens a
 * connection — the test suite imports the app many times and would otherwise exhaust
 * Postgres's connection slots.
 */

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!client) {
    const { databaseUrl } = getConfig();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }
  return client;
}

/** Close the pool. Used by the test suite and by the server's shutdown handler. */
export async function disconnectPrisma(): Promise<void> {
  if (client) {
    const closing = client;
    client = undefined;
    await closing.$disconnect();
  }
}

/**
 * A Prisma client or an interactive-transaction handle.
 *
 * Services take this rather than the client itself, so the same function works inside a
 * `$transaction` and outside one. The sync endpoint applies a whole batch in a single
 * transaction, so "can this run in a transaction" is not an optional property here.
 */
export type Db = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
