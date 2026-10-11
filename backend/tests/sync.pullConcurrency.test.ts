import { v7 as uuidv7 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { nextRevision } from '../src/db/revision.ts';
import { api } from './support/api.ts';
import { createUser, revisionWatermark, type TestUser } from './support/fixtures.ts';
import { pull, pushItem } from './support/sync.ts';

/**
 * `GET /v1/sync` against a database that is moving while it reads.
 *
 * Every other concurrency test in this suite is push against push — two requests racing
 * to write the same row (`sync.idempotency.test.ts`). The pull side has only ever been
 * read against a database that was holding still, and it is the side whose own doc
 * comment ranks the failure first: "A skipped row is permanent, silent data loss on the
 * device: the cursor has moved past it and nothing will ever send it again."
 *
 * Two mechanisms are supposed to prevent that, and neither is reachable from a
 * sequential test:
 *
 *  1. `revision_counters` is incremented inside the writing transaction, so a revision
 *     cannot become visible to a reader before the row stamped with it. `revision.ts`
 *     states this as a guarantee; `revision.test.ts` asserts it from a `for` loop with an
 *     `await` in it, which can never produce the duplicate its own comment warns about.
 *  2. `readPage` reads both tables from one `RepeatableRead` snapshot, so a write that
 *     commits between the two queries cannot leave a hole in the page.
 *
 * The strong property is asserted across a whole cursor walk rather than by inspecting
 * one page: every row arrives exactly once, and a revision already delivered is never
 * followed by a lower one. That is the only statement of "never skip a row" a
 * page-at-a-time assertion cannot fake.
 */

let user: TestUser;

beforeEach(async () => {
  user = await createUser();
});

describe('a pull that overlaps an uncommitted write', () => {
  it('neither delivers the row nor advances the cursor past it', async () => {
    // The hazard `revision.ts` names as the reason a timestamp cursor is unusable: "a
    // cursor can be advanced past a row whose transaction had not yet committed, so the
    // row is silently never delivered". Held open here on one connection while the pull
    // runs on another.
    const before = await revisionWatermark(user.user.id);
    const id = uuidv7();

    let cursorDuring = -1;
    let idsDuring: string[] = [];
    let allocated = -1;

    await getPrisma().$transaction(
      async (tx) => {
        allocated = await nextRevision(tx, user.user.id);
        await tx.expense.create({
          data: {
            id,
            userId: user.user.id,
            categoryId: user.defaultCategory.id,
            amountMinor: BigInt(4242),
            currency: user.user.currency,
            date: new Date('2026-10-06T00:00:00.000Z'),
            updatedAt: new Date(),
            revision: allocated,
          },
        });

        // Still uncommitted. A reader must see neither the row nor its revision.
        const page = await pull(user, { since: before });
        cursorDuring = page.nextCursor;
        idsDuring = page.changes.map((change) => change.record.id);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    expect(allocated).toBe(before + 1);
    expect(idsDuring).not.toContain(id);
    // Echoing `since` is the documented empty-page answer. The failure being guarded is a
    // cursor sourced from the *counter* instead, which the uncommitted increment has
    // already moved.
    expect(cursorDuring).toBe(before);
    expect(cursorDuring).toBeLessThan(allocated);

    // And the row reaches the cursor the overlapping pull handed back, so the device that
    // polled at the wrong moment is not the device that loses it.
    const after = await pull(user, { since: cursorDuring });
    expect(after.changes.map((change) => change.record.id)).toContain(id);
  });

  it('does not strand a row whose revision was committed ahead of it', async () => {
    // The case above passes under every regression tried against it, because MVCC hides
    // an uncommitted counter increment from every reader no matter what this code does.
    // It characterises Postgres, not the pull — recorded so a green verdict on it is not
    // read as coverage.
    //
    // This one can fail. `revision.ts` requirement 1 is "call this inside the transaction
    // that performs the write"; here the revision is drawn and committed in its own
    // transaction, which is precisely the violation, and it leaves the counter ahead of
    // the rows for as long as the write takes. The row survives it only because
    // `nextCursor` comes from the page rather than from the watermark — so this is the
    // case that shows the two rules are independent defences rather than one restated.
    const before = await revisionWatermark(user.user.id);
    const id = uuidv7();

    const allocated = await nextRevision(getPrisma(), user.user.id);
    expect(allocated).toBe(before + 1);
    expect(await revisionWatermark(user.user.id)).toBe(allocated);

    let cursorDuring = -1;

    await getPrisma().$transaction(
      async (tx) => {
        await tx.expense.create({
          data: {
            id,
            userId: user.user.id,
            categoryId: user.defaultCategory.id,
            amountMinor: BigInt(777),
            currency: user.user.currency,
            date: new Date('2026-10-06T00:00:00.000Z'),
            updatedAt: new Date(),
            revision: allocated,
          },
        });

        const page = await pull(user, { since: before });
        expect(page.changes).toHaveLength(0);
        cursorDuring = page.nextCursor;
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    // A client that stored the counter's value here would ask for `> allocated` next
    // time, and nothing would ever send it this row again.
    expect(cursorDuring).toBe(before);

    const after = await pull(user, { since: cursorDuring });
    expect(after.changes.map((change) => change.record.id)).toContain(id);
  });
});

describe('concurrent writers for one account', () => {
  it('each get a distinct revision, with none repeated and none skipped', async () => {
    // `revision.ts`: "Concurrent writers for the same user serialise on the counter's row
    // lock, so no two rows can ever receive the same revision." Ten requests in flight at
    // once is the only shape that can contradict it; a repeated revision means a cursor
    // can step over one of the two rows for good.
    const before = await revisionWatermark(user.user.id);
    const count = 10;

    const responses = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        api()
          .post('/v1/expenses')
          .set('Authorization', user.auth)
          .send({
            categoryId: user.defaultCategory.id,
            amountMinor: (i + 1) * 100,
            date: '2026-10-06',
          }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(count).fill(201));

    const revisions = responses
      .map((response) => response.body.data.revision as number)
      .sort((a, b) => a - b);

    expect(new Set(revisions).size).toBe(count);
    expect(revisions).toEqual(Array.from({ length: count }, (_, i) => before + 1 + i));
    expect(await revisionWatermark(user.user.id)).toBe(before + count);
  });

  it('does not serialise one account behind another', async () => {
    // The lock is per user, on that user's counter row. A global lock would also produce
    // distinct revisions, so independence is the thing to check: each account's writes
    // must be contiguous from its own watermark, with no numbers consumed by the other.
    const [first, second] = await Promise.all([createUser(), createUser()]);

    const writesFor = (account: TestUser) =>
      Array.from({ length: 4 }, (_, i) =>
        api()
          .post('/v1/expenses')
          .set('Authorization', account.auth)
          .send({
            categoryId: account.defaultCategory.id,
            amountMinor: (i + 1) * 10,
            date: '2026-10-06',
          }),
      );

    const responses = await Promise.all([...writesFor(first!), ...writesFor(second!)]);
    expect(responses.every((response) => response.status === 201)).toBe(true);

    for (const account of [first!, second!]) {
      const page = await pull(account, { since: 6 });
      // Six seeded categories, then this account's own four, uninterrupted.
      expect(page.changes.map((change) => change.record.revision)).toEqual([7, 8, 9, 10]);
    }
  });
});

describe('a client walking the cursor while writes keep committing', () => {
  it('receives every row exactly once, and never a revision below one already delivered', async () => {
    // The guarantee in full, and the reason this file exists. The walk follows the
    // documented `since = nextCursor` loop with a small limit, so it is paging the whole
    // time the writer is committing — the window in which a two-table merge taken from
    // two snapshots loses a row.
    const writes = 18;
    const writtenIds: string[] = [];

    const writer = (async () => {
      for (let i = 0; i < writes; i += 1) {
        // Both tables, interleaved: the loss `readPage` guards against needs a category
        // and an expense to land either side of the reader's two queries.
        const response =
          i % 3 === 0
            ? await api()
                .post('/v1/categories')
                .set('Authorization', user.auth)
                .send({ name: `Cat ${i}` })
            : await api()
                .post('/v1/expenses')
                .set('Authorization', user.auth)
                .send({
                  categoryId: user.defaultCategory.id,
                  amountMinor: (i + 1) * 7,
                  date: '2026-10-06',
                });
        if (response.status !== 201) {
          throw new Error(`writer failed: ${response.status} ${JSON.stringify(response.body)}`);
        }
        writtenIds.push(response.body.data.id as string);
      }
    })();

    let writerSettled = false;
    const finished = writer.then(
      () => {
        writerSettled = true;
      },
      (error: unknown) => {
        writerSettled = true;
        throw error;
      },
    );

    const delivered: { id: string; revision: number }[] = [];
    let cursor = 0;
    let pages = 0;

    for (;;) {
      // Sampled *before* the request, not after. Reading it afterwards lets the writer
      // finish during the round trip, so an empty page taken before its last commit
      // looks like "caught up, and nothing more is coming" — the walk then stops one row
      // short. My first version did exactly that and the drain below caught it, which is
      // the same mistake in the test that the protocol has to avoid in the client.
      const writerWasDone = writerSettled;
      const page = await pull(user, { since: cursor, limit: 3 });
      pages += 1;
      for (const change of page.changes) {
        delivered.push({ id: change.record.id, revision: change.record.revision });
      }
      cursor = page.nextCursor;
      if (!page.hasMore && writerWasDone) break;
      if (pages > 300) throw new Error('the walk did not terminate');
    }

    await finished;
    const drain = await pull(user, { since: cursor });
    expect(drain.changes).toHaveLength(0);

    // Exactly once. A duplicate is a cursor that went backwards; a missing row is the
    // silent loss.
    const ids = delivered.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Six seeded categories plus every row the writer created.
    expect(ids).toHaveLength(6 + writes);
    for (const id of writtenIds) expect(ids).toContain(id);

    // Monotonic across the whole walk, not merely within a page: a page whose own
    // revisions ascend can still begin below where the previous page ended, and that is
    // what stepping over a row looks like from the client's side.
    const revisions = delivered.map((entry) => entry.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBe(revisions.length);
    expect(pages).toBeGreaterThan(1);
  });

  it('never hands over an expense before the category it references', async () => {
    // `openapi.yaml` promises `Expense.categoryId` is "always a live category of the same
    // user". A client applying pages in order can only honour that if the category
    // arrives first — and a push puts both rows in one transaction, so the walk must see
    // both or neither. The failure is a device holding an expense whose category name it
    // cannot render.
    const categoryId = uuidv7();
    const expenseId = uuidv7();

    const pushing = api()
      .post('/v1/sync')
      .set('Authorization', user.auth)
      .send({
        changes: [
          pushItem({ entity: 'category', id: categoryId, fields: { name: 'Travel' } }),
          pushItem({
            entity: 'expense',
            id: expenseId,
            fields: {
              categoryId,
              amountMinor: 5000,
              currency: user.user.currency,
              date: '2026-10-06',
            },
          }),
        ],
      });

    const known = new Set<string>();
    let sawExpense = false;
    let cursor = 0;
    let settled = false;
    const finished = pushing.then(
      (response) => {
        settled = true;
        return response;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );

    const observe = (changes: Awaited<ReturnType<typeof pull>>['changes']): void => {
      for (const change of changes) {
        if (change.entity === 'category') known.add(change.record.id);
        if (change.entity === 'expense') {
          // Asserted at the moment the row arrives, rather than at the end when the
          // category has caught up regardless.
          expect(known.has(change.record.categoryId)).toBe(true);
          if (change.record.id === expenseId) sawExpense = true;
        }
      }
    };

    for (let guard = 0; guard < 300; guard += 1) {
      // Sampled before the request, for the reason given in the walk case above.
      const pushWasDone = settled;
      const page = await pull(user, { since: cursor, limit: 1 });
      observe(page.changes);
      cursor = page.nextCursor;
      if (!page.hasMore && pushWasDone) break;
    }

    const response = await finished;
    expect(response.status).toBe(200);
    observe((await pull(user, { since: cursor, limit: 50 })).changes);

    expect(sawExpense).toBe(true);
    expect(known.has(categoryId)).toBe(true);
  });
});
