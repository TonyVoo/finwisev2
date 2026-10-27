import type { Category, Expense } from '@expense-tracker/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneAllTombstones, pruneTombstones } from '../src/services/tombstoneService.ts';
import { api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';
import { pull, pushItem, pushOk, resultFor } from './support/sync.ts';

/**
 * A category tombstoned through the sync path while live expenses still reference it.
 *
 * `GAP 2` settled that the sync-path delete reassigns nothing server-side, and that this
 * is the better branch: the client's own expense items carry the earlier client
 * `updatedAt`, so a server-side reassignment with `now` would make them all lose
 * last-write-wins and silently drop an amount the user corrected in the same offline
 * session. The client therefore owns pushing each expense's new `categoryId`, which
 * `docs/design/07-categories.md` §4 rules 6–7 specifies it does, in the same batch.
 *
 * GAP 2 also named the state this leaves when the client never follows through — a device
 * lost or wiped between the category push and the expense pushes. What it did not record,
 * and what these cases measure, is how far the consequences reach: the server then serves
 * an `Expense.categoryId` that `openapi.yaml` promises is "always a live category", and
 * the category tombstone becomes un-prunable for as long as the live expense survives,
 * which is not bounded by the 90-day horizon at all.
 *
 * The two cases that pass are here to constrain the fix rather than to describe a bug.
 * Both obvious repairs are wrong, and each is wrong against one of them: reassigning
 * server-side breaks `SYNC-46`, and refusing the delete while live expenses reference it
 * breaks `SYNC-41`, because `SYNC-42` shows the protocol applies every category in a
 * batch *before* any expense — so at the moment of the delete those expenses are always
 * still pointing at it, even in the flow that is working correctly.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

const DAY = 86_400_000;

/** Create a category through `POST /v1/categories`, asserting it worked. */
async function createCategory(name: string): Promise<Category> {
  const response = await api()
    .post('/v1/categories')
    .set('Authorization', user.auth)
    .send({ name });
  if (response.status !== 201) {
    throw new Error(`fixture could not create a category: ${response.status}`);
  }
  return response.body.data as Category;
}

/** The ids `GET /v1/categories` currently serves — every live category, and only those. */
async function liveCategoryIds(): Promise<string[]> {
  const response = await api().get('/v1/categories').set('Authorization', user.auth);
  expect(response.status).toBe(200);
  return (response.body.data as Category[]).map((category) => category.id);
}

/**
 * Tombstone a category through `POST /v1/sync` and push nothing else — the client that
 * dies, or is wiped, between the category push and the expense pushes.
 */
async function syncDeleteCategory(categoryId: string, at = Date.now()): Promise<void> {
  const results = await pushOk(user, [
    pushItem({
      entity: 'category',
      id: categoryId,
      updatedAt: new Date(at).toISOString(),
      fields: { deletedAt: new Date(at).toISOString() },
    }),
  ]);
  expect(resultFor(results, categoryId).status).toBe('applied');
}

describe('a category delete pushed without its reassignments', () => {
  /**
   * `SYNC-41` — the flow that is working correctly, asserted so a fix cannot break it.
   *
   * Listed expenses-first on purpose: the client is not required to order the batch, the
   * server is (`orderBatch`). One round trip, and the tombstone is collectable at the
   * horizon like any other.
   */
  it('converges in one round trip when the batch carries the reassignments too', async () => {
    const category = await createCategory('Coffee');
    const first = await createExpense(user, { categoryId: category.id });
    const second = await createExpense(user, { categoryId: category.id });
    const at = Date.now() + 1000;

    const results = await pushOk(user, [
      pushItem({
        entity: 'expense',
        id: first.id,
        updatedAt: new Date(at).toISOString(),
        fields: { categoryId: user.defaultCategory.id },
      }),
      pushItem({
        entity: 'expense',
        id: second.id,
        updatedAt: new Date(at).toISOString(),
        fields: { categoryId: user.defaultCategory.id },
      }),
      pushItem({
        entity: 'category',
        id: category.id,
        updatedAt: new Date(at).toISOString(),
        fields: { deletedAt: new Date(at).toISOString() },
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);
    expect(
      await getPrisma().expense.count({ where: { categoryId: category.id, deletedAt: null } }),
    ).toBe(0);

    // Collectable at the horizon, which is the whole point of the reassignment landing.
    const pruned = await pruneTombstones(
      getPrisma(),
      user.user.id,
      new Date(Date.now() + 91 * DAY),
    );
    expect(pruned.categories).toBe(1);
    expect(pruned.categoriesRetained).toBe(0);
  });

  /**
   * `SYNC-42` — why refusing the delete would break `SYNC-41`.
   *
   * Every category in a batch is applied before every expense, so an expense repointed at
   * a category the same batch deletes is refused. That ordering is load-bearing for
   * offline creates, and it is also why "reject a category delete while live expenses
   * reference it" would reject the correct flow: when the delete runs, its expenses have
   * not been reassigned yet.
   */
  it('applies every category before any expense, so the delete sees them unreassigned', async () => {
    const category = await createCategory('Tea');
    const expense = await createExpense(user, { categoryId: category.id });
    const at = Date.now() + 1000;

    const results = await pushOk(user, [
      pushItem({
        entity: 'category',
        id: category.id,
        updatedAt: new Date(at).toISOString(),
        fields: { deletedAt: new Date(at).toISOString() },
      }),
      pushItem({
        entity: 'expense',
        id: expense.id,
        updatedAt: new Date(at + 1000).toISOString(),
        fields: { categoryId: category.id, amountMinor: 999 },
      }),
    ]);

    expect(resultFor(results, category.id).status).toBe('applied');
    const repointed = resultFor(results, expense.id);
    expect(repointed.status).toBe('invalid');
    expect(repointed.error?.code).toBe('unknown_category');
  });

  /**
   * `SYNC-43` — the measured state, not a tripwire, and deliberately so.
   *
   * `openapi.yaml` describes `Expense.categoryId` as "Always a live category of the same
   * user; reassigned to the `Uncategorized` default if its category is deleted". After a
   * sync-path delete whose reassignments never land, both halves of that sentence are
   * false: the reference is unresolvable by a client, because the category is absent from
   * `GET /v1/categories` precisely for being a tombstone.
   *
   * This asserts what the server *does* rather than what the contract claims, because the
   * resolution here is expected to be the contract's wording — the two code-level repairs
   * are ruled out by `SYNC-41` and `SYNC-46`. An expected-fail asserting "always live"
   * would therefore encode a fix nobody should make and stay red for good. It still earns
   * its place: if someone does make the server reassign, this case reddens and forces the
   * conversation instead of silently trading one defect for a worse one. Re-point it when
   * GAP 15's prose is settled.
   */
  it('serves an expense whose categoryId the client cannot resolve', async () => {
    const category = await createCategory('Coffee');
    const expense = await createExpense(user, { categoryId: category.id });
    await syncDeleteCategory(category.id);

    const live = await liveCategoryIds();
    expect(live).not.toContain(category.id);

    const list = await api().get('/v1/expenses').set('Authorization', user.auth);
    expect(list.status).toBe(200);
    const served = (list.body.data as Expense[]).find((row) => row.id === expense.id);
    expect(served?.categoryId).toBe(category.id);

    // And a device syncing from scratch reaches the same state: both rows, no resolution.
    const page = await pull(user, { since: 0 });
    const pulled = page.changes.find((change) => change.record.id === expense.id);
    expect((pulled?.record as Expense | undefined)?.categoryId).toBe(category.id);
  });

  /**
   * `SYNC-44` — **expected-fail.** The tombstone horizon does not apply to this row.
   *
   * `pruneTombstones` leaves a category whose expenses still exist "for the next run
   * rather than cascading", which is right for a *tombstoned* expense: that expense is
   * itself collected at its own horizon, so the next run converges. A **live** expense
   * never ages out, so this category is retained at 90 days and at 4000, and is delivered
   * in every full pull for the lifetime of the account.
   *
   * Two runs, the second eleven years out, because the design explicitly allows a
   * retained category to wait for "the next run" — so one prune proving nothing was
   * collected would not distinguish deferral from never. It asserts only the end state,
   * deliberately: an earlier draft asserted `categoriesRetained === 1` at the horizon as a
   * precondition, which a working repair makes false, so the case could not have gone
   * green against the fix it is asking for.
   */
  it('collects the tombstone once it is past the horizon', async () => {
    const category = await createCategory('Coffee');
    await createExpense(user, { categoryId: category.id });
    await syncDeleteCategory(category.id);

    const db = getPrisma();
    await pruneTombstones(db, user.user.id, new Date(Date.now() + 91 * DAY));
    await pruneTombstones(db, user.user.id, new Date(Date.now() + 4000 * DAY));

    // The assertions that fail today: the row survives, and every full pull still carries
    // a tombstone for a category deleted eleven years earlier.
    expect(await db.category.findUnique({ where: { id: category.id } })).toBeNull();
    const page = await pull(user, { since: 0 });
    expect(page.changes.some((change) => change.record.id === category.id)).toBe(false);
  });

  /**
   * `SYNC-45` — **expected-fail.** The retained count is computed and then discarded.
   *
   * `PruneResult.categoriesRetained` exists to make exactly the state above visible, and
   * the only caller in the codebase — `pruneAllTombstones`, which
   * `src/scripts/pruneTombstones.ts` runs on the schedule — drops it. A stuck account is
   * indistinguishable from a quiet one in the one line an operator sees.
   *
   * Separate from `SYNC-44` deliberately: plumbing the field through and making the prune
   * converge are different changes, and a combined case would go green on the first and
   * hide the second. It asserts the field is *reported*, not that anything is retained —
   * a repair that converges leaves nothing to retain, and the operator still needs the
   * number to be zero rather than absent.
   */
  it('reports retained categories from the scheduled aggregate', async () => {
    const category = await createCategory('Coffee');
    await createExpense(user, { categoryId: category.id });
    await syncDeleteCategory(category.id);

    const perUser = await pruneTombstones(
      getPrisma(),
      user.user.id,
      new Date(Date.now() + 91 * DAY),
    );
    // Present on the per-user result, which is what makes the omission below an omission.
    expect(perUser).toHaveProperty('categoriesRetained');

    const aggregate = await pruneAllTombstones(new Date(Date.now() + 91 * DAY));

    // The assertion that fails today: the aggregate the scheduler calls has no such field.
    expect(aggregate).toHaveProperty('categoriesRetained');
  });

  /**
   * `SYNC-46` — the recoverability that keeps this finding short of data loss, and the
   * case that rules out reassigning server-side.
   *
   * A client that comes back and pushes the reassignment late is still accepted: the
   * stored expense has not been touched since, so the client's `updatedAt` wins, and the
   * prune converges immediately afterwards. Had the server reassigned at delete time with
   * its own `now`, this push would come back `conflict_server_wins` and any amount edited
   * in the same offline session would be dropped — GAP 2's second bullet.
   */
  it('accepts the reassignment pushed late, and the prune then converges', async () => {
    const category = await createCategory('Coffee');
    const expense = await createExpense(user, { categoryId: category.id });
    await syncDeleteCategory(category.id);

    const results = await pushOk(user, [
      pushItem({
        entity: 'expense',
        id: expense.id,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
        fields: { categoryId: user.defaultCategory.id, amountMinor: 4321 },
      }),
    ]);

    const repaired = resultFor(results, expense.id);
    expect(repaired.status).toBe('applied');
    // The amount edited in the same session survives too, which is the branch GAP 2 chose.
    expect((repaired.record as Expense | undefined)?.amountMinor).toBe(4321);

    const pruned = await pruneTombstones(
      getPrisma(),
      user.user.id,
      new Date(Date.now() + 91 * DAY),
    );
    expect(pruned.categories).toBe(1);
    expect(pruned.categoriesRetained).toBe(0);
  });
});
