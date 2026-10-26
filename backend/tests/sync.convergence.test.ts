import type { Category, Expense, RecurringRule, SyncPushItem } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, type TestUser } from './support/fixtures.ts';
import { pull, pushOk } from './support/sync.ts';

/**
 * Two devices, one account, offline edits to the same rows — do they converge?
 *
 * This is the only test in the suite that asks the question the whole protocol exists to
 * answer, and it has to be an integration test: convergence is a property of the
 * *combination* of last-write-wins, the conflict response carrying the authoritative row,
 * and the pull delivering what the push did not. Each of those is tested in isolation
 * elsewhere, and all three can be individually correct while two devices still drift.
 *
 * {@link Device} below is a deliberately minimal client: a local store keyed by id, an
 * outbox, and the sync loop exactly as `docs/api/openapi.yaml` documents it — push the
 * outbox, overwrite local rows from the results (including on conflict), then pull from
 * the stored watermark until `hasMore` is false. It is not the mobile app's sync engine
 * and does not pretend to be; it is the smallest client that can be *wrong*, so that a
 * server bug which lets devices drift shows up here rather than on a handset.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

type Row = Category | Expense | RecurringRule;

/** A simulated offline client: local rows, an outbox, and a revision watermark. */
class Device {
  readonly rows = new Map<string, Row>();
  private readonly outbox: SyncPushItem[] = [];
  private cursor = 0;

  constructor(readonly name: string) {}

  /** Queue a local change, applying it to the local store first — writes never block. */
  edit(item: SyncPushItem, localRow: Row): void {
    this.rows.set(item.id, localRow);
    this.outbox.push(item);
  }

  /**
   * One sync round trip: drain the outbox, then pull.
   *
   * Push before pull on purpose. The other order loses local work: a pull would
   * overwrite an unpushed local edit with the server's older row, and the edit would be
   * gone before it was ever sent.
   */
  async sync(): Promise<void> {
    if (this.outbox.length > 0) {
      const results = await pushOk(user, this.outbox.splice(0, this.outbox.length));
      for (const result of results) {
        // The authoritative row, whatever the status. Overwriting on
        // `conflict_server_wins` as well as on `applied` is what makes this converge:
        // dropping the loser's row would leave this device holding data the server will
        // never have.
        if (result.record) this.rows.set(result.id, result.record);
        // `invalid` with no row means the server has nothing for this id; the local row
        // is unsendable, so a real client would surface it. Here: drop it.
        if (result.status === 'invalid' && result.record === null) this.rows.delete(result.id);
      }
    }

    for (;;) {
      const page = await pull(user, { since: this.cursor, limit: 50 });
      if (page.resyncRequired) {
        this.rows.clear();
        this.cursor = 0;
        continue;
      }
      for (const change of page.changes) this.rows.set(change.record.id, change.record);
      // Stored only after the whole page is applied locally. The other order loses rows
      // on a crash between the two.
      this.cursor = page.nextCursor;
      if (!page.hasMore) return;
    }
  }

  /** What the user would see: live rows only, tombstones hidden. */
  visible(): Map<string, Row> {
    return new Map([...this.rows].filter(([, row]) => row.deletedAt === null));
  }
}

/** The server's own view, read independently of either device. */
async function serverRows(): Promise<Map<string, Row>> {
  const page = await pull(user, { since: 0, limit: 500 });
  expect(page.hasMore).toBe(false);
  return new Map(page.changes.map((change) => [change.record.id, change.record]));
}

/** Both devices and the server agree, row for row. */
async function expectConverged(a: Device, b: Device): Promise<void> {
  const server = await serverRows();
  // Compared as sorted entries so the assertion failure names the row that differs
  // rather than reporting "two Maps are not equal".
  const asEntries = (rows: Map<string, Row>) =>
    [...rows.entries()].sort(([x], [y]) => (x < y ? -1 : 1));

  expect(asEntries(a.rows), `${a.name} vs server`).toEqual(asEntries(server));
  expect(asEntries(b.rows), `${b.name} vs server`).toEqual(asEntries(server));
}

const ISO = (ms: number): string => new Date(ms).toISOString();

describe('two devices diverging offline', () => {
  it('converges after a round trip when both edited the same row', async () => {
    const phone = new Device('phone');
    const tablet = new Device('tablet');

    // Both start in sync.
    await phone.sync();
    await tablet.sync();

    // A shared expense, created on the phone and pulled by the tablet.
    const expenseId = uuidv7();
    const createdAt = Date.now() - 60 * 60 * 1000;
    phone.edit(
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: ISO(createdAt),
        clientMutationId: uuidv7(),
        fields: { categoryId: user.defaultCategory.id, amountMinor: 450, date: '2026-10-09' },
      },
      {
        id: expenseId,
        categoryId: user.defaultCategory.id,
        amountMinor: 450,
        currency: user.user.currency,
        date: '2026-10-09',
        note: null,
        createdAt: ISO(createdAt),
        updatedAt: ISO(createdAt),
        deletedAt: null,
        revision: 0,
      },
    );
    await phone.sync();
    await tablet.sync();
    expect(tablet.rows.get(expenseId)).toMatchObject({ amountMinor: 450 });

    // --- both go offline and edit the same row ---
    const phoneEditedAt = createdAt + 10 * 60 * 1000;
    const tabletEditedAt = createdAt + 20 * 60 * 1000; // later: the tablet should win
    const shared = tablet.rows.get(expenseId) as Expense;

    phone.edit(
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: ISO(phoneEditedAt),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 500, note: 'from the phone' },
      },
      { ...shared, amountMinor: 500, note: 'from the phone', updatedAt: ISO(phoneEditedAt) },
    );
    tablet.edit(
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: ISO(tabletEditedAt),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 900, note: 'from the tablet' },
      },
      { ...shared, amountMinor: 900, note: 'from the tablet', updatedAt: ISO(tabletEditedAt) },
    );

    // --- connectivity returns; the loser syncs first ---
    await phone.sync();
    await tablet.sync();
    // The phone has to pull again to learn it lost.
    await phone.sync();

    await expectConverged(phone, tablet);
    expect(phone.rows.get(expenseId)).toMatchObject({
      amountMinor: 900,
      note: 'from the tablet',
    });
  });

  it('converges when the winner syncs first, so the loser is told at push time', async () => {
    // The same divergence in the other order. The late push comes back
    // `conflict_server_wins` *with the server's row*, so the phone converges inside the
    // push rather than needing another pull — which is what makes a conflict cost one
    // round trip instead of two.
    const phone = new Device('phone');
    const tablet = new Device('tablet');
    await phone.sync();
    await tablet.sync();

    const id = uuidv7();
    const base = Date.now() - 60 * 60 * 1000;
    const seed: Category = {
      id,
      name: 'Coffee',
      color: '#f59e0b',
      isDefault: false,
      monthlyBudgetMinor: null,
      createdAt: ISO(base),
      updatedAt: ISO(base),
      deletedAt: null,
      revision: 0,
    };
    phone.edit(
      {
        entity: 'category',
        id,
        updatedAt: ISO(base),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee', color: '#f59e0b' },
      },
      seed,
    );
    await phone.sync();
    await tablet.sync();

    const tabletWins = base + 20 * 60 * 1000;
    const phoneLoses = base + 10 * 60 * 1000;
    tablet.edit(
      {
        entity: 'category',
        id,
        updatedAt: ISO(tabletWins),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee & tea' },
      },
      { ...seed, name: 'Coffee & tea', updatedAt: ISO(tabletWins) },
    );
    phone.edit(
      {
        entity: 'category',
        id,
        updatedAt: ISO(phoneLoses),
        clientMutationId: uuidv7(),
        fields: { name: 'Caffeine' },
      },
      { ...seed, name: 'Caffeine', updatedAt: ISO(phoneLoses) },
    );

    await tablet.sync();
    await phone.sync();

    await expectConverged(phone, tablet);
    expect(phone.rows.get(id)).toMatchObject({ name: 'Coffee & tea' });
  });

  it('converges on a delete racing an edit', async () => {
    // The asymmetric case, and the one most likely to leave a row visible on one device
    // forever: a tombstone only reaches the other side as a row with `deletedAt` set, so
    // if the pull filtered tombstones the editing device would keep showing it.
    const phone = new Device('phone');
    const tablet = new Device('tablet');
    await phone.sync();
    await tablet.sync();

    const id = uuidv7();
    const base = Date.now() - 60 * 60 * 1000;
    const seed: Expense = {
      id,
      categoryId: user.defaultCategory.id,
      amountMinor: 450,
      currency: user.user.currency,
      date: '2026-10-09',
      note: null,
      createdAt: ISO(base),
      updatedAt: ISO(base),
      deletedAt: null,
      revision: 0,
    };
    phone.edit(
      {
        entity: 'expense',
        id,
        updatedAt: ISO(base),
        clientMutationId: uuidv7(),
        fields: { categoryId: user.defaultCategory.id, amountMinor: 450, date: '2026-10-09' },
      },
      seed,
    );
    await phone.sync();
    await tablet.sync();

    const deletedAt = base + 30 * 60 * 1000;
    const editedAt = base + 10 * 60 * 1000;
    tablet.edit(
      {
        entity: 'expense',
        id,
        updatedAt: ISO(deletedAt),
        clientMutationId: uuidv7(),
        fields: { deletedAt: ISO(deletedAt) },
      },
      { ...seed, deletedAt: ISO(deletedAt), updatedAt: ISO(deletedAt) },
    );
    phone.edit(
      {
        entity: 'expense',
        id,
        updatedAt: ISO(editedAt),
        clientMutationId: uuidv7(),
        fields: { amountMinor: 999 },
      },
      { ...seed, amountMinor: 999, updatedAt: ISO(editedAt) },
    );

    await tablet.sync();
    await phone.sync();

    await expectConverged(phone, tablet);
    expect(phone.rows.get(id)?.deletedAt).not.toBeNull();
    // The user sees it gone on both devices, which is the actual requirement.
    expect(phone.visible().has(id)).toBe(false);
    expect(tablet.visible().has(id)).toBe(false);
  });

  it('converges when each device created different rows offline', async () => {
    // No conflict at all, just two independent change sets. The thing that can go wrong
    // here is a pull that misses a row because the two devices' writes interleaved in the
    // revision sequence.
    const phone = new Device('phone');
    const tablet = new Device('tablet');
    await phone.sync();
    await tablet.sync();

    const base = Date.now() - 60 * 60 * 1000;
    for (const [device, label, offset] of [
      [phone, 'phone', 0],
      [tablet, 'tablet', 1],
    ] as const) {
      for (let i = 0; i < 4; i += 1) {
        const id = uuidv7();
        const when = ISO(base + offset * 1000 + i * 10_000);
        device.edit(
          {
            entity: 'expense',
            id,
            updatedAt: when,
            clientMutationId: uuidv7(),
            fields: {
              categoryId: user.defaultCategory.id,
              amountMinor: 100 + i,
              date: '2026-10-09',
              note: `${label} ${i}`,
            },
          },
          {
            id,
            categoryId: user.defaultCategory.id,
            amountMinor: 100 + i,
            currency: user.user.currency,
            date: '2026-10-09',
            note: `${label} ${i}`,
            createdAt: when,
            updatedAt: when,
            deletedAt: null,
            revision: 0,
          },
        );
      }
    }

    await phone.sync();
    await tablet.sync();
    await phone.sync();

    await expectConverged(phone, tablet);
    expect(phone.visible().size).toBe(6 + 8); // six seeded categories + eight expenses
  });

  it('converges a category and its expense created offline on one device, in one round trip', async () => {
    // The scenario `docs/PLAN.md` §4 calls out: a category and an expense both invented
    // on a plane. If the server did not order the batch, the expense would come back
    // `unknown_category` and the client would need a second round trip.
    const phone = new Device('phone');
    const tablet = new Device('tablet');
    await phone.sync();
    await tablet.sync();

    const categoryId = uuidv7();
    const expenseId = uuidv7();
    const when = ISO(Date.now() - 30 * 60 * 1000);

    phone.edit(
      {
        entity: 'expense',
        id: expenseId,
        updatedAt: when,
        clientMutationId: uuidv7(),
        fields: { categoryId, amountMinor: 450, date: '2026-10-09' },
      },
      {
        id: expenseId,
        categoryId,
        amountMinor: 450,
        currency: user.user.currency,
        date: '2026-10-09',
        note: null,
        createdAt: when,
        updatedAt: when,
        deletedAt: null,
        revision: 0,
      },
    );
    phone.edit(
      {
        entity: 'category',
        id: categoryId,
        updatedAt: when,
        clientMutationId: uuidv7(),
        fields: { name: 'Inflight' },
      },
      {
        id: categoryId,
        name: 'Inflight',
        color: '#f59e0b',
        isDefault: false,
        monthlyBudgetMinor: null,
        createdAt: when,
        updatedAt: when,
        deletedAt: null,
        revision: 0,
      },
    );

    await phone.sync();
    await tablet.sync();

    await expectConverged(phone, tablet);
    expect(tablet.rows.get(expenseId)).toMatchObject({ categoryId });
  });

  it('converges a device that has to resync, without losing rows written by the other device', async () => {
    const phone = new Device('phone');
    const tablet = new Device('tablet');
    await phone.sync();
    await tablet.sync();

    // The tablet has caught up and then stops syncing. Meanwhile the phone writes, and
    // the tablet's stored watermark is advanced past the server's — the "cursor from a
    // database that no longer exists" case, which forces a resync on its next pull.
    const id = uuidv7();
    const when = ISO(Date.now() - 30 * 60 * 1000);
    phone.edit(
      {
        entity: 'category',
        id,
        updatedAt: when,
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee' },
      },
      {
        id,
        name: 'Coffee',
        color: '#f59e0b',
        isDefault: false,
        monthlyBudgetMinor: null,
        createdAt: when,
        updatedAt: when,
        deletedAt: null,
        revision: 0,
      },
    );
    await phone.sync();

    const stranded = new Device('stranded-tablet');
    // Hand it a watermark from nowhere, and a stale local row, the way a restore from
    // backup would.
    (stranded as unknown as { cursor: number }).cursor = 10_000;
    stranded.rows.set('ghost', {
      id: 'ghost',
      name: 'Ghost',
      color: '#000000',
      isDefault: false,
      monthlyBudgetMinor: null,
      createdAt: when,
      updatedAt: when,
      deletedAt: null,
      revision: 1,
    });

    await stranded.sync();

    // It wiped and re-downloaded, so the ghost is gone and the phone's row is there.
    expect(stranded.rows.has('ghost')).toBe(false);
    expect(stranded.rows.get(id)).toMatchObject({ name: 'Coffee' });
    await expectConverged(phone, stranded);
    void tablet;
  });
});
