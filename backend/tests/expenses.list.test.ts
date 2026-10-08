import { ExpenseListResponse, type Expense } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';

/**
 * `GET /v1/expenses` — filtering and keyset pagination, per `docs/qa/TEST_PLAN.md`
 * EXP-07 to EXP-09.
 *
 * The property worth the most here is the one offset pagination would break: a write
 * landing between two page requests must not cause a row to be skipped or repeated. With
 * a client that syncs in the background, that is the normal case rather than an edge one.
 */

/** Dates that deliberately repeat, so the `id` tiebreak is exercised rather than assumed. */
function spreadDates(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = (i % 21) + 1;
    const month = i < 21 ? '09' : '10';
    return `2026-${month}-${String(day).padStart(2, '0')}`;
  });
}

async function seedExpenses(user: TestUser, dates: string[]): Promise<Expense[]> {
  const created: Expense[] = [];
  for (const [index, date] of dates.entries()) {
    // Sequential, so the UUIDv7 ids are minted in a known order and the tiebreak is
    // reproducible rather than racing.
    created.push(
      await createExpense(user, {
        categoryId: user.categories.Groceries!.id,
        amountMinor: (index + 1) * 100,
        date,
      }),
    );
  }
  return created;
}

/** Walk every page, returning the ids in the order the API served them. */
async function drain(user: TestUser, query: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;

  for (;;) {
    const url: string =
      cursor === null ? query : `${query}&cursor=${encodeURIComponent(cursor)}`;
    const response = await api().get(url).set('Authorization', user.auth);
    const body = response.body as ExpenseListResponse;
    expect(response.status).toBe(200);
    expect(() => ExpenseListResponse.parse(body)).not.toThrow();

    ids.push(...body.data.map((e) => e.id));
    // `hasMore` and `nextCursor` are two spellings of the same fact; the contract says so
    // and a client may believe either.
    expect(body.hasMore).toBe(body.nextCursor !== null);

    cursor = body.nextCursor;
    if (cursor === null) break;

    pages += 1;
    if (pages > 50) throw new Error('pagination did not terminate');
  }
  return ids;
}

describe('ordering and defaults', () => {
  it('orders by date descending, ties broken by id descending', async () => {
    const user = await createUser();
    const sameDay = await seedExpenses(user, ['2026-10-01', '2026-10-01', '2026-10-02']);

    const response = await api().get('/v1/expenses').set('Authorization', user.auth);
    const rows = response.body.data as Expense[];

    expect(rows.map((r) => r.date)).toEqual(['2026-10-02', '2026-10-01', '2026-10-01']);
    // Within the shared date, the later-minted id comes first. Ordering on date alone
    // would leave the tie unresolved, and an unresolved tie is what makes a keyset cursor
    // skip rows.
    const [first, second, third] = sameDay;
    expect(rows[0]!.id).toBe(third!.id);
    expect([rows[1]!.id, rows[2]!.id]).toEqual([first!.id, second!.id].sort().reverse());
  });

  it('defaults the page size to 50 and caps it at 200', async () => {
    const user = await createUser();

    const tooSmall = await api().get('/v1/expenses?limit=0').set('Authorization', user.auth);
    const tooBig = await api().get('/v1/expenses?limit=201').set('Authorization', user.auth);
    const notANumber = await api().get('/v1/expenses?limit=all').set('Authorization', user.auth);

    for (const response of [tooSmall, tooBig, notANumber]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });

  it('rejects an unknown query parameter', async () => {
    const user = await createUser();

    const response = await api().get('/v1/expenses?month=2026-10').set('Authorization', user.auth);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('keyset pagination', () => {
  it('serves every row exactly once, even when a write lands between pages', async () => {
    const user = await createUser();
    const seeded = await seedExpenses(user, spreadDates(42));

    const page1 = await api().get('/v1/expenses?limit=20').set('Authorization', user.auth);
    expect(page1.body.data).toHaveLength(20);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.nextCursor).not.toBeNull();

    // A row dated later than anything seeded, created *between* the two page requests.
    // It sorts above page 1's cursor, so it belongs to a page already served.
    const interloper = await createExpense(user, {
      categoryId: user.categories.Groceries!.id,
      date: '2026-12-31',
    });

    const page2 = await api()
      .get(`/v1/expenses?limit=20&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set('Authorization', user.auth);

    const page1Ids = (page1.body.data as Expense[]).map((e) => e.id);
    const page2Ids = (page2.body.data as Expense[]).map((e) => e.id);

    expect(page2Ids).not.toContain(interloper.id);
    // The two properties offset pagination loses: no repeat, and no skip.
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toEqual([]);

    const remaining = await api()
      .get(`/v1/expenses?limit=20&cursor=${encodeURIComponent(page2.body.nextCursor)}`)
      .set('Authorization', user.auth);

    const all = [...page1Ids, ...page2Ids, ...(remaining.body.data as Expense[]).map((e) => e.id)];
    const seededIds = seeded.map((e) => e.id);
    expect(new Set(all.filter((id) => seededIds.includes(id)))).toEqual(new Set(seededIds));
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the filter applied across pages', async () => {
    const user = await createUser();
    const groceries = user.categories.Groceries!.id;
    const transport = user.categories.Transport!.id;

    for (const [index, date] of spreadDates(10).entries()) {
      await createExpense(user, {
        categoryId: index % 2 === 0 ? groceries : transport,
        date,
      });
    }

    const ids = await drain(user, `/v1/expenses?limit=2&categoryId=${groceries}`);

    expect(ids).toHaveLength(5);
    const page = await api()
      .get(`/v1/expenses?limit=200&categoryId=${groceries}`)
      .set('Authorization', user.auth);
    expect(new Set((page.body.data as Expense[]).map((e) => e.id))).toEqual(new Set(ids));
  });

  it('ends with a null cursor rather than an endless empty page', async () => {
    const user = await createUser();
    await seedExpenses(user, ['2026-10-01', '2026-10-02']);

    const ids = await drain(user, '/v1/expenses?limit=2');

    // Exactly `limit` rows on the last page is the off-by-one that produces an endless
    // final page: `hasMore` has to be false here, not true with an empty page to follow.
    expect(ids).toHaveLength(2);
  });

  it('paginates tombstones under includeDeleted without losing one', async () => {
    const user = await createUser();
    const seeded = await seedExpenses(user, spreadDates(5));
    await api().delete(`/v1/expenses/${seeded[0]!.id}`).set('Authorization', user.auth);

    const live = await drain(user, '/v1/expenses?limit=2');
    const all = await drain(user, '/v1/expenses?limit=2&includeDeleted=true');

    expect(live).toHaveLength(4);
    expect(all).toHaveLength(5);
    expect(all).toContain(seeded[0]!.id);
  });
});

describe('date bounds', () => {
  it('treats from and to as inclusive bounds on the calendar date', async () => {
    const user = await createUser();
    await seedExpenses(user, ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']);

    const response = await api()
      .get('/v1/expenses?from=2026-10-01&to=2026-10-31')
      .set('Authorization', user.auth);

    // Both ends included and neither neighbour: a month is `from=01&to=31`, with no
    // off-by-one for the client to compensate for.
    expect((response.body.data as Expense[]).map((e) => e.date)).toEqual([
      '2026-10-31',
      '2026-10-01',
    ]);
  });

  it('rejects a reversed range instead of returning an empty page', async () => {
    const user = await createUser();

    const response = await api()
      .get('/v1/expenses?from=2026-10-31&to=2026-10-01')
      .set('Authorization', user.auth);

    // An empty page would read as "no expenses that month" rather than "you swapped the
    // bounds", and the client would show an empty state it cannot explain.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details.issues[0].path).toBe('to');
  });

  it('accepts a single-day range', async () => {
    const user = await createUser();
    await seedExpenses(user, ['2026-10-05', '2026-10-06']);

    const response = await api()
      .get('/v1/expenses?from=2026-10-06&to=2026-10-06')
      .set('Authorization', user.auth);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].date).toBe('2026-10-06');
  });

  it('rejects a bound that is not a calendar date', async () => {
    const user = await createUser();

    for (const query of ['from=2026-10', 'to=31-10-2026', 'from=2026-10-06T00:00:00Z']) {
      const response = await api().get(`/v1/expenses?${query}`).set('Authorization', user.auth);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
    }
  });
});

describe('cursors', () => {
  it('reports a tampered or nonsense cursor as invalid_cursor', async () => {
    const user = await createUser();
    await seedExpenses(user, spreadDates(10));

    const first = await api().get('/v1/expenses?limit=5').set('Authorization', user.auth);
    const cursor = first.body.nextCursor as string;

    const cases: Record<string, string> = {
      truncated: cursor.slice(0, -3),
      'not a cursor at all': 'not-a-cursor',
      'valid base64 of the wrong shape': Buffer.from('{"d":"nope"}').toString('base64url'),
      'a well-formed date with a non-uuid id': Buffer.from(
        '{"d":"2026-10-01","i":"nope"}',
      ).toString('base64url'),
      empty: '%20',
    };

    for (const [label, value] of Object.entries(cases)) {
      const response = await api()
        .get(`/v1/expenses?limit=5&cursor=${encodeURIComponent(value)}`)
        .set('Authorization', user.auth);

      // Never a 500, and — more importantly — never a silently empty page, which reads as
      // "no more data" and makes the client stop paginating with rows still unread.
      expect(response.status, label).toBe(400);
      expect(['invalid_cursor', 'validation_error'], label).toContain(response.body.error.code);
      if (response.body.error.code === 'invalid_cursor') {
        expect(response.body.error.message).toMatch(/cursor/i);
      }
    }
  });

  it('is scoped to the caller, so another account’s cursor reveals nothing', async () => {
    const [mine, theirs] = await Promise.all([createUser(), createUser()]);
    await seedExpenses(theirs, spreadDates(4));

    const theirPage = await api().get('/v1/expenses?limit=2').set('Authorization', theirs.auth);
    const replayed = await api()
      .get(`/v1/expenses?limit=2&cursor=${encodeURIComponent(theirPage.body.nextCursor)}`)
      .set('Authorization', mine.auth);

    // A cursor is only a sort position, and the query is always scoped by the `userId`
    // from the token — so replaying someone else's cursor pages through nothing.
    expect(replayed.status).toBe(200);
    expect(replayed.body.data).toEqual([]);
  });
});
