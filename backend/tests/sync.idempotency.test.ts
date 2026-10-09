import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneAllTombstones, pruneTombstones } from '../src/services/tombstoneService.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { pull, push, pushOk } from './support/sync.ts';

/**
 * `clientMutationId` idempotency, tested by actually submitting the duplicate.
 *
 * A unit-level check of "does the ledger lookup fire" would pass with the guarantee
 * broken, because the failure mode is not a missing lookup — it is two requests whose
 * lookups both miss. So every test here sends the same mutation twice through HTTP, and
 * the last one sends both at once on separate connections, which is what a client
 * retrying a request whose response was dropped actually does.
 *
 * The bug this prevents is the one `docs/PLAN.md` §4 calls the most common offline-sync
 * bug: a flaky-network retry that double-applies.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

const ISO = (ms: number): string => new Date(ms).toISOString();

describe('a replayed push', () => {
  it('returns the original result and does not apply twice', async () => {
    const id = uuidv7();
    const clientMutationId = uuidv7();
    const item = {
      entity: 'category',
      id,
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId,
      fields: { name: 'Coffee' },
    };

    const [first] = await pushOk(user, [item]);
    const watermarkAfterFirst = await revisionWatermark(user.user.id);

    const [second] = await pushOk(user, [item]);

    expect(first?.status).toBe('applied');
    expect(first?.idempotentReplay).toBe(false);
    // The recorded status, replayed.
    expect(second?.status).toBe('applied');
    expect(second?.idempotentReplay).toBe(true);
    expect(second?.record?.revision).toBe(first?.record?.revision);
    // The row was not written again, so no revision was spent and the row did not land on
    // another sync page for every other device on the account.
    expect(await revisionWatermark(user.user.id)).toBe(watermarkAfterFirst);
    expect(
      await getPrisma().category.count({ where: { userId: user.user.id, name: 'Coffee' } }),
    ).toBe(1);
  });

  it('does not re-deliver the row to a pull after the replay', async () => {
    const item = {
      entity: 'category',
      id: uuidv7(),
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId: uuidv7(),
      fields: { name: 'Coffee' },
    };
    await pushOk(user, [item]);
    const watermark = await revisionWatermark(user.user.id);

    await pushOk(user, [item]);

    expect((await pull(user, { since: watermark })).changes).toEqual([]);
  });

  it('replays a conflict as a conflict', async () => {
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 900,
    });
    const item = {
      entity: 'expense',
      id: expense.id,
      updatedAt: ISO(Date.parse(expense.updatedAt) - 60_000),
      clientMutationId: uuidv7(),
      fields: { amountMinor: 450 },
    };

    const [first] = await pushOk(user, [item]);
    const [second] = await pushOk(user, [item]);

    expect(first?.status).toBe('conflict_server_wins');
    expect(second?.status).toBe('conflict_server_wins');
    expect(second?.idempotentReplay).toBe(true);
  });

  it('replays an invalid as an invalid, with the same error', async () => {
    const item = {
      entity: 'expense',
      id: uuidv7(),
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId: uuidv7(),
      fields: { categoryId: uuidv7(), amountMinor: 450, date: '2026-10-09' },
    };

    const [first] = await pushOk(user, [item]);
    const [second] = await pushOk(user, [item]);

    // An invalid outcome is recorded too, so a retry of a permanently-bad row is a cheap
    // replay rather than a re-validation on every drain of the outbox.
    expect(first?.status).toBe('invalid');
    expect(second?.status).toBe('invalid');
    expect(second?.idempotentReplay).toBe(true);
    expect(second?.error?.code).toBe('unknown_category');
  });

  it('replays a malformed item as an invalid without re-parsing it', async () => {
    const item = {
      entity: 'category',
      id: uuidv7(),
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId: uuidv7(),
      fields: { name: '' },
    };

    const [first] = await pushOk(user, [item]);
    const [second] = await pushOk(user, [item]);

    expect(first?.status).toBe('invalid');
    expect(second?.idempotentReplay).toBe(true);
    expect(second?.error?.code).toBe('validation_error');
  });

  it('carries the current authoritative row, not a snapshot from when it first ran', async () => {
    // A replay reports the *recorded status* with *today's* row. The client overwrites its
    // local copy with `record`, so a stale snapshot would undo whatever landed in between
    // — a retry from a reconnecting device would roll the row back.
    const id = uuidv7();
    const clientMutationId = uuidv7();
    const item = {
      entity: 'category',
      id,
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId,
      fields: { name: 'Coffee' },
    };
    await pushOk(user, [item]);

    // A later, unrelated edit to the same row.
    const [renamed] = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(Date.now()),
        clientMutationId: uuidv7(),
        fields: { name: 'Coffee & tea' },
      },
    ]);
    expect(renamed?.status).toBe('applied');

    const [replay] = await pushOk(user, [item]);

    expect(replay?.idempotentReplay).toBe(true);
    expect(replay?.status).toBe('applied');
    expect(replay?.record).toMatchObject({ name: 'Coffee & tea' });
    expect(replay?.record?.revision).toBe(renamed?.record?.revision);
  });

  it('replays within a single batch when the same mutation appears twice', async () => {
    const item = {
      entity: 'category',
      id: uuidv7(),
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId: uuidv7(),
      fields: { name: 'Coffee' },
    };

    const results = await pushOk(user, [item, item]);

    expect(results[0]?.idempotentReplay).toBe(false);
    // The ledger read sees the insert made earlier in the same transaction, so a client
    // that queued the same mutation twice locally is not punished for it.
    expect(results[1]?.idempotentReplay).toBe(true);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
  });
});

describe('a genuine concurrent duplicate submission', () => {
  it('applies once and replays the other, from two requests in flight at the same time', async () => {
    // Exactly what a client does when a response is dropped and it retries while the
    // original is still being processed. Both requests look up the ledger and both miss;
    // only the primary key can decide which one wins, which is why the guarantee lives in
    // the database rather than in the resolver.
    const id = uuidv7();
    const item = {
      entity: 'category',
      id,
      updatedAt: ISO(Date.now() - 60_000),
      clientMutationId: uuidv7(),
      fields: { name: 'Coffee' },
    };

    const before = await revisionWatermark(user.user.id);
    const [a, b] = await Promise.all([push(user, [item]), push(user, [item])]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const replays = [a, b].map((outcome) => outcome.body.results[0]?.idempotentReplay);
    // One applied, one replayed — in whichever order the database settled it.
    expect(replays.filter((replay) => replay === true)).toHaveLength(1);
    expect(replays.filter((replay) => replay === false)).toHaveLength(1);

    for (const outcome of [a, b]) {
      expect(outcome.body.results[0]?.status).toBe('applied');
      expect(outcome.body.results[0]?.record).toMatchObject({ id, name: 'Coffee' });
    }

    // Applied once: one new row, one revision, one ledger entry.
    expect(await revisionWatermark(user.user.id)).toBe(before + 1);
    expect(
      await getPrisma().category.count({ where: { userId: user.user.id, name: 'Coffee' } }),
    ).toBe(1);
    expect(await getPrisma().syncMutation.count({ where: { userId: user.user.id } })).toBe(1);
  });

  it('does not double-apply an increment-shaped retry of an update', async () => {
    // The shape where double-applying is visible rather than merely wasteful.
    const expense = await createExpense(user, {
      categoryId: user.defaultCategory.id,
      amountMinor: 100,
    });
    const item = {
      entity: 'expense',
      id: expense.id,
      updatedAt: ISO(Date.parse(expense.updatedAt) + 1000),
      clientMutationId: uuidv7(),
      fields: { amountMinor: 250 },
    };

    await Promise.all([push(user, [item]), push(user, [item]), push(user, [item])]);

    const stored = await getPrisma().expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(Number(stored.amountMinor)).toBe(250);
    // One write, so one revision past the create.
    expect(stored.revision).toBe(expense.revision + 1);
  });

  it('resolves two different mutations creating the same id as a create and an update', async () => {
    // The other half of the create race, and the reason the retry re-runs the item from
    // the top rather than just replaying the ledger. Both pushes read the row, both see
    // nothing (it is uncommitted in the other transaction), and both decide to create;
    // the loser blocks on the primary key and then has to resolve as an *update*, because
    // its `clientMutationId` is its own and there is no result to replay.
    const id = uuidv7();
    const base = Date.now() - 60_000;
    const [a, b] = await Promise.all([
      push(user, [
        {
          entity: 'category',
          id,
          updatedAt: ISO(base),
          clientMutationId: uuidv7(),
          fields: { name: 'Older' },
        },
      ]),
      push(user, [
        {
          entity: 'category',
          id,
          updatedAt: ISO(base + 60_000),
          clientMutationId: uuidv7(),
          fields: { name: 'Newer' },
        },
      ]),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Neither is a replay: these are two genuinely different mutations.
    for (const outcome of [a, b]) {
      expect(outcome.body.results[0]?.idempotentReplay).toBe(false);
      // And neither is `invalid`: losing a race is a stale read, not a client mistake. A
      // client told `invalid` here would drop a change that should have been applied.
      expect(outcome.body.results[0]?.status).not.toBe('invalid');
    }

    // Last-write-wins settles it, whichever order the database ran them in.
    const stored = await getPrisma().category.findUniqueOrThrow({ where: { id } });
    expect(stored.name).toBe('Newer');
    expect(await getPrisma().category.count({ where: { id } })).toBe(1);
  });
});

describe('a reused clientMutationId with a different payload', () => {
  it('is invalid with mutation_id_reused rather than silently applied', async () => {
    const clientMutationId = uuidv7();
    const id = uuidv7();
    await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId,
        fields: { name: 'Coffee' },
      },
    ]);

    const [result] = await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(Date.now()),
        clientMutationId,
        fields: { name: 'Tea' },
      },
    ]);

    // The client lost track of its outbox. Accepting this would write one mutation under
    // another's idempotency key and hide the bug.
    expect(result?.status).toBe('invalid');
    expect(result?.error?.code).toBe('mutation_id_reused');
    expect(result?.idempotentReplay).toBe(false);
    // The authoritative row still comes back, so the client can converge.
    expect(result?.record).toMatchObject({ name: 'Coffee' });
    expect(await getPrisma().category.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: 'Coffee',
    });
  });

  it('is not triggered by a retry whose JSON key order differs', async () => {
    // A retry is a re-serialisation of the same local row, and nothing promises the same
    // key order. Hashing canonically is what keeps an honest retry from being reported as
    // a client bug.
    const clientMutationId = uuidv7();
    const id = uuidv7();
    const updatedAt = ISO(Date.now() - 60_000);

    await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt,
        clientMutationId,
        fields: { name: 'Coffee', color: '#f59e0b' },
      },
    ]);
    const [replay] = await pushOk(user, [
      {
        fields: { color: '#f59e0b', name: 'Coffee' },
        clientMutationId,
        updatedAt,
        id,
        entity: 'category',
      },
    ]);

    expect(replay?.status).toBe('applied');
    expect(replay?.idempotentReplay).toBe(true);
    expect(replay?.error).toBeNull();
  });
});

describe('the ledger is scoped per user', () => {
  it('lets two accounts use the same clientMutationId independently', async () => {
    // "Unique per user", not globally: the ids are client-minted, and one account's
    // outbox must not be able to block another's mutation.
    const other = await createUser();
    const clientMutationId = uuidv7();

    const [mine] = await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId,
        fields: { name: 'Coffee' },
      },
    ]);
    const [theirs] = await pushOk(other, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId,
        fields: { name: 'Coffee' },
      },
    ]);

    expect(mine?.status).toBe('applied');
    expect(mine?.idempotentReplay).toBe(false);
    expect(theirs?.status).toBe('applied');
    expect(theirs?.idempotentReplay).toBe(false);
  });

  it('enforces uniqueness in the database, not only in the resolver', async () => {
    // The resolver's lookup is an optimisation; this primary key is the guarantee. If it
    // were ever dropped, the concurrency test above would start failing intermittently —
    // so assert it directly rather than relying on a race to notice.
    const userId = user.user.id;
    const clientMutationId = uuidv7();
    const insert = () =>
      getPrisma().syncMutation.create({
        data: {
          userId,
          clientMutationId,
          entity: 'category',
          recordId: uuidv7(),
          status: 'applied',
          payloadHash: 'a'.repeat(64),
        },
      });

    await insert();
    await expect(insert()).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('an unauthenticated replay', () => {
  it('cannot read a ledger entry belonging to another account', async () => {
    const other = await createUser();
    const clientMutationId = uuidv7();
    const id = uuidv7();

    await pushOk(user, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId,
        fields: { name: 'Coffee' },
      },
    ]);

    // The same key, the same id, a different account: the id belongs to someone else, so
    // this must not be a replay carrying the other user's row.
    const [result] = await pushOk(other, [
      {
        entity: 'category',
        id,
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId,
        fields: { name: 'Coffee' },
      },
    ]);

    expect(result?.idempotentReplay).toBe(false);
    expect(result?.status).toBe('invalid');
    expect(result?.record).toBeNull();
  });

  it('rejects a push with no token before touching the ledger', async () => {
    const response = await api()
      .post('/v1/sync')
      .send({
        changes: [
          {
            entity: 'category',
            id: uuidv7(),
            updatedAt: ISO(Date.now()),
            clientMutationId: uuidv7(),
            fields: { name: 'Coffee' },
          },
        ],
      });
    expect(response.status).toBe(401);
    expect(await getPrisma().syncMutation.count()).toBe(0);
  });
});

/**
 * The ledger's retention window — QA GAP 3, filed against `pruneTombstones`.
 *
 * `sync_mutations` is the one table in the schema with no ceiling. It gains a row per
 * mutation per user forever: nothing deletes from it, `created_at` is written and never
 * read, and `pruneTombstones` sweeps `expenses` and `categories` only. Remembering every
 * id forever is the *safe* answer for de-duplication, which is why this is not a
 * correctness bug today — it is unbounded growth plus a boundary no test can reach.
 *
 * The two `it.fails` cases below are tripwires, not pending work: each passes while the
 * defect is present and turns red the moment it is fixed, which is the signal to delete
 * the `.fails` and keep the assertion. They are deliberately orthogonal — one covers
 * *what* is deleted, the other *which users the job visits* — because a sweep added
 * inside `pruneTombstones` alone would fix the first and leave the second broken, and a
 * single combined case would hide that.
 */
describe('the idempotency ledger has no retention bound', () => {
  /** Push one category, then backdate its ledger row's `created_at` by `days`. */
  async function pushAndAgeLedgerRow(days: number): Promise<void> {
    const clientMutationId = uuidv7();
    await pushOk(user, [
      {
        entity: 'category',
        id: uuidv7(),
        updatedAt: ISO(Date.now() - 60_000),
        clientMutationId,
        fields: { name: 'Coffee' },
      },
    ]);
    await getPrisma().syncMutation.update({
      where: { userId_clientMutationId: { userId: user.user.id, clientMutationId } },
      data: { createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    });
  }

  const ledgerRows = async (): Promise<number> =>
    getPrisma().syncMutation.count({ where: { userId: user.user.id } });

  it.fails('prunes a ledger entry older than the tombstone horizon', async () => {
    await pushAndAgeLedgerRow(91);

    await pruneTombstones(getPrisma(), user.user.id);

    // Fails today: the row survives, because no statement in the pruner addresses it.
    expect(await ledgerRows()).toBe(0);
  });

  it('leaves a ledger entry inside the horizon alone', async () => {
    await pushAndAgeLedgerRow(89);

    await pruneTombstones(getPrisma(), user.user.id);

    // Vacuous while nothing prunes the ledger, and deliberately kept: it is the only
    // guard against the fix over-pruning and breaking de-duplication for a client that
    // retries inside the window — which is the failure that loses the user's data,
    // where leaking rows only costs disk.
    expect(await ledgerRows()).toBe(1);
  });

  it.fails('visits a user whose only stale rows are in the ledger', async () => {
    // No tombstone anywhere for this user — just an aged ledger row.
    await pushAndAgeLedgerRow(91);

    const result = await pruneAllTombstones();

    // Fails today at 0. `pruneAllTombstones` discovers users with a UNION over
    // tombstoned `categories` and `expenses` only, so this account is never passed to
    // `pruneTombstones` at all. If this case is still failing once the sweep above is
    // green, the sweep landed inside `pruneTombstones` and the job that calls it still
    // cannot find the users who need it.
    expect(result.users).toBe(1);
  });
});
