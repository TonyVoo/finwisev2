import { LIMITS } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_CLAMP_MS,
  TOMBSTONE_HORIZON_DAYS,
  clampClientUpdatedAt,
  decideLww,
  inApplyOrder,
  needsResync,
  tombstoneHorizon,
  wasClamped,
} from '../src/sync/resolver.ts';

/**
 * Unit tests for the sync resolver's decisions.
 *
 * `docs/PLAN.md` §7 singles this code out as "the part most likely to be subtly wrong
 * and the hardest to debug in the field", and the reason is that every rule in it has an
 * exact boundary: equal timestamps, a clock 5 minutes fast versus 5 minutes and one
 * millisecond, a cursor sitting *on* the pruned watermark. Each of those is one
 * comparison operator away from a bug that loses a user's edit or resurrects a deleted
 * row, and none of them shows up in a happy-path integration test.
 *
 * So they are tested here, at the boundary, against pure functions — no database, no
 * fixture, no HTTP. The branches are also exercised end to end in `sync.push.test.ts`
 * and `sync.pull.test.ts`; these tests are what pin the *edges*.
 */

const NOW = new Date('2026-10-09T12:00:00.000Z');

/** `NOW` shifted by a number of milliseconds, for readable boundary cases. */
function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

describe('clampClientUpdatedAt', () => {
  it('uses the shared clamp window so both sides agree on it', () => {
    expect(CLOCK_SKEW_CLAMP_MS).toBe(LIMITS.CLIENT_CLOCK_SKEW_CLAMP_MS);
    expect(CLOCK_SKEW_CLAMP_MS).toBe(5 * 60 * 1000);
  });

  it('leaves a past timestamp alone', () => {
    const past = at(-60_000);
    expect(clampClientUpdatedAt(past, NOW).toISOString()).toBe(past.toISOString());
    expect(wasClamped(past, NOW)).toBe(false);
  });

  it('leaves a timestamp exactly on the ceiling alone', () => {
    // The clamp is `>`, not `>=`: a client precisely 5 minutes fast is within tolerance,
    // and rewriting its timestamp would be a change with no benefit.
    const edge = at(CLOCK_SKEW_CLAMP_MS);
    expect(clampClientUpdatedAt(edge, NOW).toISOString()).toBe(edge.toISOString());
    expect(wasClamped(edge, NOW)).toBe(false);
  });

  it('clamps a timestamp one millisecond past the ceiling', () => {
    const over = at(CLOCK_SKEW_CLAMP_MS + 1);
    expect(clampClientUpdatedAt(over, NOW).toISOString()).toBe(
      at(CLOCK_SKEW_CLAMP_MS).toISOString(),
    );
    expect(wasClamped(over, NOW)).toBe(true);
  });

  it('clamps a wildly-skewed clock to the ceiling, not to now', () => {
    // A device a year fast must not win every future conflict on the row. Clamping to
    // `now` instead of `now + 5min` would be the other mistake: it would make a genuinely
    // concurrent edit from a slightly-fast device lose for no reason.
    const nextYear = new Date('2027-10-09T12:00:00.000Z');
    expect(clampClientUpdatedAt(nextYear, NOW).toISOString()).toBe(
      at(CLOCK_SKEW_CLAMP_MS).toISOString(),
    );
  });

  it('does not clamp a clock that is behind', () => {
    // A slow clock loses conflicts it should have won, which costs an edit. The server
    // cannot tell that apart from a genuinely older edit, and raising it would let a
    // broken clock overwrite good data.
    const lastWeek = at(-7 * 24 * 60 * 60 * 1000);
    expect(clampClientUpdatedAt(lastWeek, NOW).toISOString()).toBe(lastWeek.toISOString());
  });
});

describe('decideLww', () => {
  it('applies a strictly newer incoming write', () => {
    expect(decideLww({ incomingUpdatedAt: at(1), storedUpdatedAt: NOW })).toBe('applied');
  });

  it('applies when the server has never seen the row', () => {
    expect(decideLww({ incomingUpdatedAt: at(-1_000_000), storedUpdatedAt: null })).toBe('applied');
  });

  it('gives a conflict when the stored row is newer', () => {
    expect(decideLww({ incomingUpdatedAt: NOW, storedUpdatedAt: at(1) })).toBe(
      'conflict_server_wins',
    );
  });

  it('gives a conflict when the timestamps are exactly equal', () => {
    // The tie-break is the whole point. A client re-pushing an unacknowledged row sends
    // back the exact `updatedAt` the server stored, so equality is common rather than
    // exotic. Letting a tie apply would burn a revision and a sync page per retry while
    // changing nothing, and would make the outcome depend on which device pushed first.
    expect(decideLww({ incomingUpdatedAt: NOW, storedUpdatedAt: NOW })).toBe(
      'conflict_server_wins',
    );
  });

  it('decides on a one-millisecond difference in either direction', () => {
    expect(decideLww({ incomingUpdatedAt: at(1), storedUpdatedAt: NOW })).toBe('applied');
    expect(decideLww({ incomingUpdatedAt: at(-1), storedUpdatedAt: NOW })).toBe(
      'conflict_server_wins',
    );
  });

  it('is what turns a clamped future clock into a conflict', () => {
    // The two rules compose: a client claiming an hour from now is clamped back to
    // `now + 5min`, and a server row written 10 minutes from now then wins. Without the
    // clamp the client would win, and would keep winning forever.
    const stored = at(10 * 60 * 1000);
    const incoming = clampClientUpdatedAt(at(60 * 60 * 1000), NOW);
    expect(decideLww({ incomingUpdatedAt: incoming, storedUpdatedAt: stored })).toBe(
      'conflict_server_wins',
    );
  });
});

describe('tombstoneHorizon', () => {
  it('uses the shared 90-day horizon', () => {
    expect(TOMBSTONE_HORIZON_DAYS).toBe(LIMITS.TOMBSTONE_HORIZON_DAYS);
    expect(TOMBSTONE_HORIZON_DAYS).toBe(90);
  });

  it('is exactly 90 days before now', () => {
    expect(tombstoneHorizon(NOW).toISOString()).toBe('2026-07-11T12:00:00.000Z');
  });
});

describe('needsResync', () => {
  const base = { serverRevision: 100, prunedThroughRevision: 40 };

  it('never asks a client at since=0 to resync', () => {
    // `since=0` already *is* a full download. Answering `resyncRequired` would be an
    // infinite loop: wipe local state, pull from 0, be told to wipe again.
    expect(needsResync({ ...base, since: 0 })).toBe(false);
    expect(needsResync({ since: 0, serverRevision: 0, prunedThroughRevision: 0 })).toBe(false);
  });

  it('serves a cursor above the pruned watermark incrementally', () => {
    expect(needsResync({ ...base, since: 41 })).toBe(false);
  });

  it('serves a cursor sitting exactly on the pruned watermark', () => {
    // The watermark is the highest revision destroyed. A client at exactly that number
    // has already seen every pruned delete, so an incremental answer is complete.
    expect(needsResync({ ...base, since: 40 })).toBe(false);
  });

  it('demands a resync one revision below the pruned watermark', () => {
    // Revision 40's tombstone is gone and this client has not seen it, so no page can
    // ever tell it about that delete. Serving one would leave it holding a deleted row.
    expect(needsResync({ ...base, since: 39 })).toBe(true);
  });

  it('serves a cursor at the current watermark as up to date', () => {
    expect(needsResync({ ...base, since: 100 })).toBe(false);
  });

  it('demands a resync for a cursor above the current watermark', () => {
    // The client is holding a cursor from a database that no longer exists — a restore
    // from backup, or a reset environment. Every later pull would come back empty and it
    // would never learn it is stranded.
    expect(needsResync({ ...base, since: 101 })).toBe(true);
  });

  it('demands a resync when nothing was pruned but the cursor is from another database', () => {
    expect(needsResync({ since: 5, serverRevision: 2, prunedThroughRevision: 0 })).toBe(true);
  });
});

describe('inApplyOrder', () => {
  const entityOf = (item: { entity: 'category' | 'expense' }) => item.entity;

  it('puts every category before every expense', () => {
    const items = [
      { entity: 'expense' as const, tag: 'e1' },
      { entity: 'category' as const, tag: 'c1' },
      { entity: 'expense' as const, tag: 'e2' },
      { entity: 'category' as const, tag: 'c2' },
    ];
    expect(inApplyOrder(items, entityOf).map((p) => p.item.tag)).toEqual(['c1', 'c2', 'e1', 'e2']);
  });

  it('remembers the request position of each item, so results can go back in order', () => {
    const items = [
      { entity: 'expense' as const },
      { entity: 'category' as const },
      { entity: 'expense' as const },
    ];
    expect(inApplyOrder(items, entityOf).map((p) => p.index)).toEqual([1, 0, 2]);
  });

  it('is stable within an entity, so two edits to one row keep their order', () => {
    // Last-write-wins has to see the user's edits in the order they were made. A sort
    // that reordered same-entity items could apply the older edit last, and the row would
    // settle on the wrong value.
    const items = Array.from({ length: 8 }, (_, i) => ({ entity: 'expense' as const, tag: i }));
    expect(inApplyOrder(items, entityOf).map((p) => p.item.tag)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('handles an empty batch and a single-entity batch', () => {
    expect(inApplyOrder([], entityOf)).toEqual([]);
    expect(inApplyOrder([{ entity: 'category' as const }], entityOf).map((p) => p.index)).toEqual([
      0,
    ]);
  });
});
