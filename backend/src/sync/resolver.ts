import { LIMITS, SYNC_APPLY_ORDER, type SyncEntity } from '@expense-tracker/shared';

/**
 * The sync decisions, as pure functions.
 *
 * Everything in this file is a decision and nothing in it touches the database. That
 * split is deliberate: `docs/PLAN.md` §7 calls the resolver "the part most likely to be
 * subtly wrong and the hardest to debug in the field", and a rule expressed as a pure
 * function can be tested exhaustively at the boundary — equal timestamps, a clock five
 * minutes and one millisecond fast, a cursor exactly on the horizon — without a fixture
 * per case. `services/syncPushService.ts` and `services/syncPullService.ts` own the
 * transactions and call in here for every judgement they make.
 */

/** How far ahead of the server a client's `updatedAt` may be. */
export const CLOCK_SKEW_CLAMP_MS = LIMITS.CLIENT_CLOCK_SKEW_CLAMP_MS;

/** How long a tombstone survives before it is pruned. */
export const TOMBSTONE_HORIZON_DAYS = LIMITS.TOMBSTONE_HORIZON_DAYS;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Clamp a client-supplied `updatedAt` to `now + 5 minutes`.
 *
 * Last-write-wins has to order on the client's clock, because the client is the only
 * party that knows when the user actually made the edit. The cost is that a device with
 * a badly-set clock writes a far-future `updatedAt` and then wins *every* later conflict
 * on that row — the row becomes unfixable from any other device, permanently, and no
 * amount of correct behaviour elsewhere recovers it.
 *
 * The clamp bounds that damage to five minutes. It is applied before the comparison and
 * before storing, so the stored row never carries a timestamp the server does not
 * believe, and a clamped item can legitimately come back `conflict_server_wins` even
 * though its raw `updatedAt` looked newer.
 *
 * Only the future is clamped. A clock that is *behind* loses conflicts it should have
 * won, which costs the user an edit — annoying, recoverable, and not something the
 * server can distinguish from a genuinely older edit anyway.
 */
export function clampClientUpdatedAt(incoming: Date, now: Date): Date {
  const ceiling = now.getTime() + CLOCK_SKEW_CLAMP_MS;
  return incoming.getTime() > ceiling ? new Date(ceiling) : incoming;
}

/** Was the incoming `updatedAt` far enough in the future that the clamp bit? */
export function wasClamped(incoming: Date, now: Date): boolean {
  return incoming.getTime() > now.getTime() + CLOCK_SKEW_CLAMP_MS;
}

/** The two outcomes last-write-wins can reach. `invalid` is not one of them. */
export type LwwDecision = 'applied' | 'conflict_server_wins';

/**
 * Last-write-wins, on the already-clamped incoming `updatedAt`.
 *
 * **Ties go to the server.** The incoming write has to be *strictly* newer to land.
 * Equal timestamps are not rare — a client that re-pushes an unacknowledged row sends
 * back the exact `updatedAt` the server stored — and "newer or equal loses" is what
 * makes the outcome deterministic regardless of which device pushes first. The
 * alternative, letting a tie apply, costs a revision and a sync page per retry while
 * changing nothing.
 *
 * A row the server has never seen (`storedUpdatedAt === null`) is always `applied`:
 * there is nothing to lose to.
 */
export function decideLww(args: {
  readonly incomingUpdatedAt: Date;
  readonly storedUpdatedAt: Date | null;
}): LwwDecision {
  if (args.storedUpdatedAt === null) return 'applied';
  return args.incomingUpdatedAt.getTime() > args.storedUpdatedAt.getTime()
    ? 'applied'
    : 'conflict_server_wins';
}

/** The instant a tombstone must be older than to be prunable. */
export function tombstoneHorizon(now: Date): Date {
  return new Date(now.getTime() - TOMBSTONE_HORIZON_DAYS * MS_PER_DAY);
}

/**
 * Can `since` still be served incrementally, or must the client wipe and start over?
 *
 * Two situations make an incremental answer wrong, and both are silent data corruption
 * if answered with a normal page:
 *
 *  1. **`since` predates the pruned horizon.** A tombstone with a revision above `since`
 *     has been destroyed, so the delete it carried can never be delivered. Serving a
 *     page would leave the client holding a row the server no longer has — the "dormant
 *     client resurrects deleted rows" failure in `docs/PLAN.md` §4.
 *  2. **`since` is above the user's current watermark.** The client is holding a cursor
 *     from a database that no longer exists (a restore from backup, a reset
 *     environment). Every subsequent pull would come back empty and the client would
 *     never learn it is stranded.
 *
 * `since = 0` is never a resync. It already *is* a full download, and answering
 * `resyncRequired` to it would be an infinite loop: wipe, pull from 0, be told to wipe.
 * That is the one case worth stating explicitly rather than leaving to the arithmetic.
 */
export function needsResync(args: {
  readonly since: number;
  readonly serverRevision: number;
  readonly prunedThroughRevision: number;
}): boolean {
  if (args.since <= 0) return false;
  if (args.since > args.serverRevision) return true;
  return args.since < args.prunedThroughRevision;
}

/** An item paired with the position it occupied in the request. */
export interface Positioned<T> {
  readonly index: number;
  readonly item: T;
}

/**
 * Reorder a batch into dependency order — every `category` before every `expense` —
 * while remembering where each item came from.
 *
 * This is what lets an expense created offline against a category created offline in
 * the same session sync in a single round trip, which is the difference between "works
 * on a plane" and "works on a plane, eventually". The client is asked to push in this
 * order too; sorting here as well means the two cannot disagree, and a client that gets
 * it wrong is not punished with a spurious `unknown_category`.
 *
 * The sort is stable within an entity, so two mutations to the same row keep their
 * relative order and last-write-wins sees them in the order the user made them. The
 * `index` is carried because the response must come back in *request* order: the client
 * matches results to its outbox positionally as well as by `clientMutationId`.
 */
export function inApplyOrder<T>(
  items: readonly T[],
  entityOf: (item: T) => SyncEntity,
): Positioned<T>[] {
  const rank = new Map<SyncEntity, number>(SYNC_APPLY_ORDER.map((entity, i) => [entity, i]));
  return items
    .map((item, index) => ({ index, item }))
    .sort((a, b) => {
      const byEntity = (rank.get(entityOf(a.item)) ?? 0) - (rank.get(entityOf(b.item)) ?? 0);
      // Index as the tiebreak is what makes this stable. `Array.prototype.sort` is
      // specified as stable in ES2019, but relying on that here would make the
      // guarantee invisible to the next reader of this function.
      return byEntity !== 0 ? byEntity : a.index - b.index;
    });
}
