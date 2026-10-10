import type { Expense, SyncPushItem } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { pull, pushOk } from './support/sync.ts';

/**
 * One row, several outbox entries in one batch — what the mobile client actually sends.
 *
 * Every other sync test in this suite pushes **one item per row per device**, including
 * `sync.convergence.test.ts`, whose `Device` is explicitly "the smallest client that can
 * be wrong". That shape is the client `docs/design/02-offline-and-sync.md` §2 rule 2
 * describes: "Editing a `pending` row updates the same row and coalesces into the
 * outbox — it does not queue a second mutation."
 *
 * The landed client does the opposite, deliberately and with a test of its own:
 * `mobile/src/db/write.ts` always `INSERT`s a fresh `outbox` row, and
 * `mobile/tests/db/write.test.ts` pins it as "appends a second entry rather than
 * replacing the first", with distinct `clientMutationId`s so a retry of one is not
 * mistaken for the other. So a user who edits one expense twice offline pushes **two
 * items for one row**, each carrying only the fields that changed at that moment.
 *
 * Nothing had exercised that shape end to end. These cases do, and they exist to make
 * the choice between the two clients an informed one rather than a coin toss — see
 * `GAP 17` in `docs/qa/TEST_PLAN.md`. The headline is in `SYNC-48`: on a conflict, two
 * entries resolve **per field** rather than per row, and the server can end up holding a
 * row neither device ever had.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

const ISO = (ms: number): string => new Date(ms).toISOString();

/** Two hours ago, so every timestamp below is in the past and the clamp never bites. */
const BASE = Date.now() - 2 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** An expense push item. `fields` is partial on purpose: that is what the outbox stores. */
function item(
  id: string,
  updatedAt: number,
  fields: Partial<{
    categoryId: string;
    amountMinor: number;
    date: string;
    note: string | null;
    deletedAt: string | null;
  }>,
): SyncPushItem {
  return {
    entity: 'expense',
    id,
    updatedAt: ISO(updatedAt),
    clientMutationId: uuidv7(),
    fields,
  } as SyncPushItem;
}

/** The row the server holds, read back independently of any push result. */
async function serverRow(id: string): Promise<Expense> {
  const page = await pull(user, { since: 0, limit: 500 });
  const change = page.changes.find((c) => c.record.id === id);
  if (change === undefined) throw new Error(`the server has no row ${id}`);
  return change.record as Expense;
}

/** Create `id` on the server at `BASE`, the state both devices start from. */
async function seed(id: string, amountMinor: number): Promise<void> {
  const results = await pushOk(user, [
    item(id, BASE, { categoryId: user.defaultCategory.id, amountMinor, date: '2026-10-09' }),
  ]);
  expect(results[0]?.status).toBe('applied');
}

describe('one row, two outbox entries in one batch', () => {
  it('SYNC-47: both apply, and the row ends at the later entry’s state', async () => {
    const id = uuidv7();
    await seed(id, 1000);
    const before = await revisionWatermark(user.user.id);

    // The outbox after two offline edits of one row: amount first, then the note. Each
    // entry carries only what that edit changed.
    const results = await pushOk(user, [
      item(id, BASE + 10 * MINUTE, { amountMinor: 1100 }),
      item(id, BASE + 20 * MINUTE, { note: 'lunch with Sam' }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);

    const row = await serverRow(id);
    // Both edits survive: the merge is per field, so the second entry does not erase the
    // amount the first one set. This is the normal path, and it is the half of `SYNC-04`
    // that was only ever claimed ("the server ends up with the final amount and note").
    expect(row).toMatchObject({
      amountMinor: 1100,
      note: 'lunch with Sam',
      updatedAt: ISO(BASE + 20 * MINUTE),
    });

    // The cost of not coalescing, made visible rather than argued: two revisions and two
    // ledger entries for one row's worth of change. Both are bounded resources — the
    // revision is the pull cursor, the ledger is the table `TVO-22` is about.
    expect(await revisionWatermark(user.user.id)).toBe(before + 2);
  });

  it('SYNC-48: a conflict resolves per field, leaving a row neither device ever had', async () => {
    const split = uuidv7();
    await seed(split, 1000);

    // The other device edits the whole row once, at a time *between* this device's two
    // offline edits, and gets there first.
    await pushOk(user, [item(split, BASE + 15 * MINUTE, { amountMinor: 2200 })]);

    // This device's outbox, pushed as one batch.
    const splitResults = await pushOk(user, [
      item(split, BASE + 10 * MINUTE, { amountMinor: 1100 }), // older than the other device
      item(split, BASE + 20 * MINUTE, { note: 'from the phone' }), // newer than it
    ]);

    expect(splitResults.map((r) => r.status)).toEqual(['conflict_server_wins', 'applied']);

    const splitRow = await serverRow(split);
    // The finding. The amount is the *other* device's and the note is this one's, so the
    // stored row is a state that existed on neither device and that no user authored.
    // For an expense that is worse than either device winning outright: the note now
    // describes an amount it was never written about.
    expect(splitRow).toMatchObject({ amountMinor: 2200, note: 'from the phone' });

    // The same divergence, same timestamps, pushed by a *coalescing* client — one entry
    // carrying both fields at the later time, which is what §2 rule 2 specifies. Run
    // here rather than described, because it is the whole argument for changing one side
    // or the other.
    const merged = uuidv7();
    await seed(merged, 1000);
    await pushOk(user, [item(merged, BASE + 15 * MINUTE, { amountMinor: 2200 })]);
    const mergedResults = await pushOk(user, [
      item(merged, BASE + 20 * MINUTE, { amountMinor: 1100, note: 'from the phone' }),
    ]);

    expect(mergedResults.map((r) => r.status)).toEqual(['applied']);
    // Row-level last-write-wins, which is what `02-offline-and-sync.md` §5.2 describes
    // when it says the loser's row is overwritten with the server's: one device's edit
    // wins whole, and the stored row is one a user actually saw.
    expect(await serverRow(merged)).toMatchObject({
      amountMinor: 1100,
      note: 'from the phone',
    });
  });

  it('SYNC-49: two entries sharing one millisecond lose the second one’s fields', async () => {
    const id = uuidv7();
    const at = BASE + 10 * MINUTE;

    // A create and an edit stamped in the same millisecond. `applyLocalMutation` reads
    // `systemClock()` per mutation, so this needs two saves inside one millisecond —
    // a double-tap on Save, or any code path that writes twice without awaiting a tick.
    // Rare, and the reason it is worth pinning is that the outcome is silent.
    const results = await pushOk(user, [
      item(id, at, { categoryId: user.defaultCategory.id, amountMinor: 1000, date: '2026-10-09' }),
      item(id, at, { note: 'the second save' }),
    ]);

    // Ties go to the server (`sync/resolver.ts`), and by the time the second entry is
    // judged the server holds what the first one wrote — so the row's own earlier entry
    // is what beats it.
    expect(results.map((r) => r.status)).toEqual(['applied', 'conflict_server_wins']);

    const row = await serverRow(id);
    expect(row.note).toBeNull();
    // Both entries drained and neither failed, so a client following §5.2 — overwrite on
    // conflict, clear `pending` — ends up correct locally. The note the user typed is
    // simply gone, with no `invalid`, no retry and nothing to show them. A coalescing
    // client cannot reach this: one entry cannot tie with itself.
    //
    // Both results carry the authoritative row, so neither is a dead end for a client.
    // Asserted directly rather than through `resultFor`: that helper throws unless a
    // batch holds exactly one result per id, which is the coalescing model again — this
    // file is the first in the suite whose batches it cannot read.
    expect(results.filter((r) => r.id === id && r.record !== null)).toHaveLength(2);
  });

  it('SYNC-50: convergence survives the split, but only if every result is written back', async () => {
    const id = uuidv7();
    await seed(id, 1000);
    await pushOk(user, [item(id, BASE + 15 * MINUTE, { amountMinor: 2200 })]);

    const results = await pushOk(user, [
      item(id, BASE + 10 * MINUTE, { amountMinor: 1100 }),
      item(id, BASE + 20 * MINUTE, { note: 'from the phone' }),
    ]);

    const server = await serverRow(id);

    // A client that writes back every result in request order converges inside the push,
    // which is what makes a conflict cost one round trip instead of two. The last result
    // for the row is the authoritative one.
    const applied = [...results].reverse().find((r) => r.id === id && r.record !== null);
    expect(applied?.record).toEqual(server);

    // A client that writes back *only* the conflicted record — the obvious reading of
    // "on `conflict_server_wins`, overwrite the local row with the server row" — stores
    // the row as it was when its first entry lost, which is already stale: its own
    // second entry then changed it. So it holds an amount that is right and a note that
    // is missing, with nothing pending to correct it.
    const conflicted = results.find((r) => r.status === 'conflict_server_wins');
    expect(conflicted?.record).toMatchObject({ amountMinor: 2200, note: null });
    expect((conflicted?.record as Expense).note).not.toBe((server as Expense).note);

    // The pull does repair it, so this is a stale window rather than a permanent drift —
    // worth knowing in both directions before `TVO-13` writes the write-back.
    const page = await pull(user, { since: 0, limit: 500 });
    expect(page.changes.find((c) => c.record.id === id)?.record).toEqual(server);
  });
});
