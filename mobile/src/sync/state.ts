/**
 * The six states of the sync pill, derived from four independent inputs.
 *
 * `docs/design/02-offline-and-sync.md` §3 specifies the pill as a table of conditions,
 * and the shape of that table is the whole design of this module. Three of its six rows
 * are conditioned on reachability - **4** `Offline` and **5** `Offline · {n} pending`
 * read it directly, and **6** `Sync failed` is qualified "while online", so it cannot be
 * computed without it either. An engine that only knew whether its last request
 * succeeded could not tell 4 from 6 at all, and those two are the opposite ends of the
 * design's emotional range: grey and expected versus red and broken.
 *
 * So the inputs are deliberately four separate facts rather than one success/failure
 * flag. Keeping them apart is also what makes the awkward transition expressible: a push
 * fails while online and the radio goes off a moment later. With a boolean the pill
 * shows `Sync failed` - red, "something is broken" - for a device that is merely in a
 * tunnel, which §3 rule 3 rules out in as many words: being offline "is not an error"
 * and "the copy never apologises for it or implies something is broken". The engine
 * clears {@link SyncInputs.lastAttemptFailed} when reachability drops, and the ordering
 * below means a stale flag could not surface as state 6 even if it did not.
 */

export type SyncPillState =
  /** 1 - online, nothing queued. Renders nothing at all. */
  | 'idle'
  /** 2 - a push or pull is in flight. */
  | 'syncing'
  /** 3 - queued work, online, not in flight. */
  | 'pending'
  /** 4 - unreachable, nothing queued. */
  | 'offline'
  /** 5 - unreachable, queued work. */
  | 'offline-pending'
  /** 6 - reachable, and the last attempt failed. */
  | 'error';

export interface SyncInputs {
  /** What netinfo says. Not "did the last request work". */
  readonly reachable: boolean;
  readonly inFlight: boolean;
  /** Whether the last *completed* attempt failed, while reachable. */
  readonly lastAttemptFailed: boolean;
  /**
   * Distinct records with undrained outbox entries - not entries, so three edits to one
   * expense read as `1 pending` (§3 rule 5).
   */
  readonly pendingRecords: number;
}

/**
 * Which row of §3's table applies.
 *
 * The order of the branches is the specification, not an implementation detail:
 *
 * - `syncing` outranks everything, because a request in flight is the most recent fact.
 * - **Offline outranks error.** This is the second half of the stale-flag defence. A
 *   failure recorded while online says nothing about a device that is now unreachable,
 *   and showing `Sync failed` instead of `Offline` is the single most misleading thing
 *   this pill can do.
 * - Pending outranks idle, obviously, and is folded into the offline rows as the design
 *   does rather than being a separate axis.
 */
export function syncPillState(inputs: SyncInputs): SyncPillState {
  if (inputs.inFlight) return 'syncing';
  if (!inputs.reachable) return inputs.pendingRecords > 0 ? 'offline-pending' : 'offline';
  if (inputs.lastAttemptFailed) return 'error';
  return inputs.pendingRecords > 0 ? 'pending' : 'idle';
}

/** States 3-6 open the sync detail sheet; 1 and 2 are not interactive (§3 rule 4). */
export function isPillTappable(state: SyncPillState): boolean {
  return (
    state === 'pending' || state === 'offline' || state === 'offline-pending' || state === 'error'
  );
}
