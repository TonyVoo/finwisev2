import { z } from 'zod';
import { Timestamp } from './primitives.js';

/** Unauthenticated liveness probe. The only endpoint that takes no access token. */
export const HealthResponse = z.strictObject({
  status: z.literal('ok'),
  version: z.string().describe('Deployed backend version (package version or git sha).'),
  time: Timestamp.describe('Server clock, so a client can sanity-check its own.'),
  db: z.literal('up').describe('Set only when the Postgres connectivity check passed.'),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
