import { z } from 'zod';
import { Revision, Timestamp, Uuid } from './primitives.js';

/**
 * Metadata carried by every syncable row (categories, expenses).
 *
 * Deletes are soft everywhere. A sync protocol cannot propagate a hard delete — an
 * absent row is indistinguishable from one the client has never seen — so `deletedAt`
 * is the tombstone that carries the deletion across.
 */
export const SYNCABLE_SHAPE = {
  id: Uuid,
  createdAt: Timestamp.describe('When the server first stored the row. Server-owned; immutable.'),
  updatedAt: Timestamp.describe(
    "The client's edit time, clamped server-side to `now + 5min`. This is the field last-write-wins orders on.",
  ),
  deletedAt: Timestamp.nullable().describe(
    'Tombstone marker. Non-null means the row is deleted; the client must hide it. Pruned 90 days after deletion.',
  ),
  revision: Revision,
} as const;

/** Fields the client may never set directly. Attempting to sets `immutable_field`. */
export const SERVER_OWNED_FIELDS = ['id', 'userId', 'createdAt', 'revision', 'createdBy'] as const;

export type ServerOwnedField = (typeof SERVER_OWNED_FIELDS)[number];

/** Convenience schema for just the syncable metadata, e.g. in tests. */
export const SyncableMeta = z.strictObject(SYNCABLE_SHAPE);
export type SyncableMeta = z.infer<typeof SyncableMeta>;
