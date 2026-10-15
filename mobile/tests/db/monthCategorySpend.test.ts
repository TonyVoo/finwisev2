import { migrate } from '@/db/migrations';
import { monthCategorySpend, monthExpenseCount, monthTotalMinor } from '@/db/queries';
import { monthRange } from '@/lib/calendar';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * The Summary's one aggregate: `src/db/queries.ts`, `monthCategorySpend`.
 *
 * Every figure on the Summary screen comes off these rows - the month total, the expense
 * count, the chart and the legend - so this suite is where that screen's arithmetic is
 * pinned. It runs against a real SQLite engine (`tests/support/sqlite.ts`), because the
 * things worth asserting are the ones the engine decides: that `BETWEEN` on text really
 * includes both bounds, that a `SUM` over integers really stays an integer, and that
 * `COLLATE NOCASE` really changes the order.
 *
 * Fixtures are built so a right answer and a wrong one look different: amounts are
 * distinct and uneven, two dates sit exactly on the month boundary, and the ordering cases
 * use names whose alphabetical order disagrees with both insertion order and id order.
 *
 * These cases replace the characterisation in `tests/db/summaryQuery.test.ts` for the
 * Summary's half of `SUM-15`-`SUM-19`: that file measured the statement the *design*
 * prints, before any module ran it. This one measures the module.
 */

const AT = '2026-10-09T10:30:00.000Z';

const OCTOBER = monthRange('2026-10');
const SEPTEMBER = monthRange('2026-09');

/** UUIDv7s in ascending order, so "later id" means "created later". */
const ids = {
  uncategorized: '0192f5a0-0000-7000-8000-000000000001',
  housing: '0192f5a0-0000-7000-8000-000000000002',
  groceries: '0192f5a0-0000-7000-8000-000000000003',
  transport: '0192f5a0-0000-7000-8000-000000000004',
  appliances: '0192f5a0-0000-7000-8000-000000000005',
  rent: '0192f5a0-0000-7000-8000-000000000006',
} as const;

interface SeedCategory {
  readonly id: string;
  readonly name: string;
  readonly color?: string;
  readonly isDefault?: boolean;
  readonly deletedAt?: string;
}

interface SeedExpense {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  /** Mid-October unless a case is about a boundary or another month. */
  readonly date?: string;
  readonly deletedAt?: string;
  /**
   * When the row was *entered*, which is never what a total buckets on. Defaults to
   * November - after every fixture month - so a query that grouped on `createdAt` would
   * put the whole fixture in the wrong month rather than accidentally agreeing.
   */
  readonly createdAt?: string;
}

/**
 * The two zones `SUM-02` runs in: the far side of the date line in both directions.
 *
 * The caveat `tests/lib/calendar.test.ts` states applies here too - V8 may keep the zone
 * it first read, so a case "in Pacific/Niue" may have run in the suite's own zone. What
 * these cases assert is therefore that the answer does not *vary*, over a path that takes
 * no local reading at all: `monthRange` builds its bounds from integers and the stored
 * `date` is compared as text. A real device is what measures the rest.
 */
const KIRITIMATI = 'Pacific/Kiritimati'; // UTC+14
const NIUE = 'Pacific/Niue'; // UTC-11

describe('a month of spend, grouped by category', () => {
  let database: TestDatabase;
  let revision = 0;

  /** Rows as a sync pull writes them: settled, no outbox entry. */
  const pullCategories = async (...categories: readonly SeedCategory[]): Promise<void> => {
    for (const category of categories) {
      await database.runAsync(
        `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, deletedAt, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          category.id,
          category.name,
          category.color ?? '#2F8044',
          category.isDefault === true ? 1 : 0,
          AT,
          AT,
          category.deletedAt ?? null,
          (revision += 1),
        ],
      );
    }
  };

  const pullExpenses = async (...expenses: readonly SeedExpense[]): Promise<void> => {
    for (const expense of expenses) {
      await database.runAsync(
        `INSERT INTO expenses
           (id, categoryId, amountMinor, currency, date, note, createdAt, updatedAt, deletedAt, revision)
         VALUES (?, ?, ?, 'USD', ?, NULL, ?, ?, ?, ?)`,
        [
          expense.id,
          expense.categoryId,
          expense.amountMinor,
          expense.date ?? '2026-10-09',
          expense.createdAt ?? '2026-11-02T08:00:00.000Z',
          AT,
          expense.deletedAt ?? null,
          (revision += 1),
        ],
      );
    }
  };

  const october = () => monthCategorySpend(database, OCTOBER);

  /** What the screen displays: the total is the sum of the groups (rule 1). */
  const sumOf = (rows: readonly { readonly totalMinor: number }[]): number =>
    rows.reduce((total, row) => total + row.totalMinor, 0);

  const countOf = (rows: readonly { readonly expenseCount: number }[]): number =>
    rows.reduce((count, row) => count + row.expenseCount, 0);

  beforeEach(async () => {
    database = createTestDatabase();
    revision = 0;
    await migrate(database);
    await pullCategories({
      id: ids.uncategorized,
      name: 'Uncategorized',
      color: '#6B7280',
      isDefault: true,
    });
  });

  afterEach(() => {
    database.close();
  });

  it('returns no rows for a month with no expenses', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    // Adjacent months on both sides, so "no rows" is the bounds working rather than an
    // empty table.
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 52000, date: '2026-09-30' },
      { id: 'e2', categoryId: ids.housing, amountMinor: 11100, date: '2026-11-01' },
    );

    const rows = await october();

    expect(rows).toEqual([]);
    // `SUM()` over no rows is NULL, not 0 (`SUM-19`), which is why the total is summed
    // from the groups here rather than coalesced out of a second query: no groups, no
    // NULL, and the zero the empty state needs falls out (`08-monthly-summary.md` state
    // `empty`).
    expect(sumOf(rows)).toBe(0);
    expect(countOf(rows)).toBe(0);
  });

  it('returns one row carrying the whole month for a single expense', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing', color: '#2F6FD0' });
    await pullExpenses({ id: 'e1', categoryId: ids.housing, amountMinor: 52000 });

    expect(await october()).toEqual([
      {
        categoryId: ids.housing,
        name: 'Housing',
        color: '#2F6FD0',
        totalMinor: 52000,
        expenseCount: 1,
      },
    ]);
  });

  it('groups several categories, largest first, and agrees with the list total', async () => {
    await pullCategories(
      { id: ids.housing, name: 'Housing' },
      { id: ids.groceries, name: 'Groceries' },
      { id: ids.transport, name: 'Transport' },
    );
    await pullExpenses(
      { id: 'e1', categoryId: ids.groceries, amountMinor: 14250, date: '2026-10-02' },
      { id: 'e2', categoryId: ids.housing, amountMinor: 52000, date: '2026-10-03' },
      { id: 'e3', categoryId: ids.groceries, amountMinor: 17000, date: '2026-10-04' },
      { id: 'e4', categoryId: ids.transport, amountMinor: 14200, date: '2026-10-05' },
    );

    const rows = await october();

    // Amount descending, which is both the legend order and the slice order (rule 4).
    expect(rows.map((row) => [row.name, row.totalMinor, row.expenseCount])).toEqual([
      ['Housing', 52000, 1],
      ['Groceries', 31250, 2],
      ['Transport', 14200, 1],
    ]);

    // `SUM-07`'s invariant, and the reason this aggregate is the screen's only read: the
    // figures Summary shows and the figures Home shows are the same arithmetic.
    expect(sumOf(rows)).toBe(97450);
    expect(await monthTotalMinor(database, OCTOBER)).toBe(97450);
    expect(countOf(rows)).toBe(4);
    expect(await monthExpenseCount(database, OCTOBER)).toBe(4);
  });

  it('includes the first and the last day of the month and excludes the days either side', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses(
      // The four boundary dates. A `<` where the query needs `<=` drops one of the middle
      // two; a bound built from a `Date` moves one of the outer two.
      { id: 'e1', categoryId: ids.housing, amountMinor: 1, date: '2026-09-30' },
      { id: 'e2', categoryId: ids.housing, amountMinor: 200, date: '2026-10-01' },
      { id: 'e3', categoryId: ids.housing, amountMinor: 30000, date: '2026-10-31' },
      { id: 'e4', categoryId: ids.housing, amountMinor: 4000000, date: '2026-11-01' },
    );

    const rows = await october();

    // Distinct orders of magnitude, so which rows landed is readable from the total.
    expect(sumOf(rows)).toBe(30200);
    expect(countOf(rows)).toBe(2);
    // And the neighbours are not lost - they are in their own months.
    expect(sumOf(await monthCategorySpend(database, SEPTEMBER))).toBe(1);
    expect(sumOf(await monthCategorySpend(database, monthRange('2026-11')))).toBe(4000000);
  });

  it('buckets on the expense date and not on when the row was entered', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses(
      // Dated September, typed in November. The acceptance criterion in prose: "an expense
      // dated last month must count toward last month regardless of when it was entered".
      {
        id: 'e1',
        categoryId: ids.housing,
        amountMinor: 52000,
        date: '2026-09-15',
        createdAt: '2026-11-20T23:00:00.000Z',
      },
      // And the reverse: dated October, typed before the month began. A row created
      // offline carries no `createdAt` at all until it syncs, which is the other half of
      // why it cannot be the bucket.
      {
        id: 'e2',
        categoryId: ids.housing,
        amountMinor: 31250,
        date: '2026-10-20',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    );

    expect(sumOf(await october())).toBe(31250);
    expect(sumOf(await monthCategorySpend(database, SEPTEMBER))).toBe(52000);
  });

  it.each([KIRITIMATI, NIUE])('puts an expense in the same month in %s', async (timeZone) => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 200, date: '2026-10-01' },
      { id: 'e2', categoryId: ids.housing, amountMinor: 30000, date: '2026-10-31' },
      { id: 'e3', categoryId: ids.housing, amountMinor: 1, date: '2026-09-30' },
    );

    const original = process.env.TZ;
    process.env.TZ = timeZone;
    try {
      // The whole path a screen takes, `MonthKey` included, so the bounds are built in the
      // zone under test rather than before it was set.
      const rows = await monthCategorySpend(database, monthRange('2026-10'));

      // UTC+14 and UTC-11 are 25 hours apart, so a boundary date passed through a local
      // `Date` lands in a different month in one of them. Both days stay in October here,
      // and September's expense stays out of it.
      expect(sumOf(rows)).toBe(30200);
      expect(countOf(rows)).toBe(2);
      expect(sumOf(await monthCategorySpend(database, monthRange('2026-09')))).toBe(1);
    } finally {
      process.env.TZ = original;
    }
  });

  it('excludes a soft-deleted expense from the total, the count and its category row', async () => {
    await pullCategories(
      { id: ids.housing, name: 'Housing' },
      { id: ids.groceries, name: 'Groceries' },
    );
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 52000 },
      { id: 'e2', categoryId: ids.housing, amountMinor: 31250, deletedAt: AT },
      // The only expense in its category, so the tombstone has to remove the legend row
      // and not merely reduce a figure on it.
      { id: 'e3', categoryId: ids.groceries, amountMinor: 999, deletedAt: AT },
    );

    const rows = await october();

    expect(rows).toEqual([
      {
        categoryId: ids.housing,
        name: 'Housing',
        color: '#2F8044',
        totalMinor: 52000,
        expenseCount: 1,
      },
    ]);
    expect(sumOf(rows)).toBe(52000);
    expect(countOf(rows)).toBe(1);
  });

  /**
   * `TVO-31` item 1, and the reason this query departs from the statement the spec prints.
   *
   * A category tombstoned while its expenses are still live is what an ordinary sync
   * produces, and the legend's join has to answer for it. Folding into the fallback keeps
   * the money on screen and keeps the two tabs equal.
   */
  it('folds an expense under a deleted category into the fallback, keeping the total whole', async () => {
    await pullCategories(
      { id: ids.housing, name: 'Housing' },
      { id: ids.groceries, name: 'Groceries', deletedAt: AT },
    );
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 52000 },
      { id: 'e2', categoryId: ids.groceries, amountMinor: 31250 },
    );

    const rows = await october();

    expect(rows.map((row) => [row.name, row.totalMinor])).toEqual([
      ['Housing', 52000],
      ['Uncategorized', 31250],
    ]);
    // The number this case exists for: Summary's total equals Home's, which is what
    // dropping the orphan would break (`$832.50` against `$520.00`).
    expect(sumOf(rows)).toBe(83250);
    expect(await monthTotalMinor(database, OCTOBER)).toBe(83250);
    // And it is filed under a row that has a name and a colour, which the slice stroke and
    // the legend both require (§Accessibility rule 4).
    expect(rows[1]?.categoryId).toBe(ids.uncategorized);
    expect(rows[1]?.color).toBe('#6B7280');
  });

  it('merges the fallback with the orphans folded into it, so it appears once', async () => {
    await pullCategories(
      { id: ids.groceries, name: 'Groceries', deletedAt: AT },
      { id: ids.transport, name: 'Transport', deletedAt: AT },
    );
    await pullExpenses(
      // One expense already filed under the fallback, plus two orphans from two different
      // deleted categories. A fold applied after aggregation would leave three rows and
      // the user would read `Uncategorized` three times.
      { id: 'e1', categoryId: ids.uncategorized, amountMinor: 1000 },
      { id: 'e2', categoryId: ids.groceries, amountMinor: 200 },
      { id: 'e3', categoryId: ids.transport, amountMinor: 30 },
    );

    expect(await october()).toEqual([
      {
        categoryId: ids.uncategorized,
        name: 'Uncategorized',
        color: '#6B7280',
        totalMinor: 1230,
        expenseCount: 3,
      },
    ]);
  });

  it('still counts an orphan when there is no fallback row to fold it into', async () => {
    // A broken invariant only a buggy peer can produce: the `isDefault` row itself is
    // tombstoned. The amount is money the user spent, so it stays in the total and the
    // screen names the row rather than dropping it.
    await database.runAsync('UPDATE categories SET deletedAt = ? WHERE id = ?', [
      AT,
      ids.uncategorized,
    ]);
    await pullCategories({ id: ids.groceries, name: 'Groceries', deletedAt: AT });
    await pullExpenses({ id: 'e1', categoryId: ids.groceries, amountMinor: 31250 });

    const rows = await october();

    expect(rows).toEqual([
      { categoryId: null, name: null, color: null, totalMinor: 31250, expenseCount: 1 },
    ]);
    expect(sumOf(rows)).toBe(31250);
    expect(await monthTotalMinor(database, OCTOBER)).toBe(31250);
  });

  /** `SUM-15`: the tie order the `default` state specifies, which `ORDER BY total` alone leaves open. */
  it('breaks a tie on category name, ascending', async () => {
    await pullCategories(
      { id: ids.transport, name: 'Transport' },
      { id: ids.groceries, name: 'Groceries' },
      { id: ids.appliances, name: 'Appliances' },
    );
    await pullExpenses(
      // Inserted in an order that is neither the answer nor its reverse, under ids whose
      // ascending order is a third order again.
      { id: 'e1', categoryId: ids.transport, amountMinor: 2000 },
      { id: 'e2', categoryId: ids.groceries, amountMinor: 2000 },
      { id: 'e3', categoryId: ids.appliances, amountMinor: 2000 },
    );

    expect((await october()).map((row) => row.name)).toEqual([
      'Appliances',
      'Groceries',
      'Transport',
    ]);
  });

  /** `SUM-16`: the same tiebreak against the uncollated column would file `rent` last. */
  it('breaks that tie case-insensitively', async () => {
    await pullCategories(
      { id: ids.transport, name: 'Transport' },
      { id: ids.rent, name: 'rent' },
    );
    await pullExpenses(
      { id: 'e1', categoryId: ids.transport, amountMinor: 2000 },
      { id: 'e2', categoryId: ids.rent, amountMinor: 2000 },
    );

    // Under SQLite's default BINARY collation every capital sorts before every lowercase,
    // so this is `['Transport', 'rent']` without `COLLATE NOCASE` - `TVO-19`'s defect in a
    // second query.
    expect((await october()).map((row) => row.name)).toEqual(['rent', 'Transport']);
  });

  it('sums in integer minor units, with no float anywhere on the path', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses(
      // Three amounts whose decimal sum is not representable as a float: 0.10 + 0.20 is
      // not 0.30. As integers the answer is exact, which is why nothing divides before
      // the formatter at the edge.
      { id: 'e1', categoryId: ids.housing, amountMinor: 10 },
      { id: 'e2', categoryId: ids.housing, amountMinor: 20 },
      { id: 'e3', categoryId: ids.housing, amountMinor: 1 },
    );

    const [row] = await october();

    expect(row?.totalMinor).toBe(31);
    expect(Number.isInteger(row?.totalMinor)).toBe(true);
  });

  /**
   * `SUM-18`, and `TVO-31` item 4: a month of zero-amount expenses is not empty.
   *
   * This app will not create such a row (`06-expense-form.md` rule 6 disables Save at
   * zero), but the server accepts one on all four write paths, so it arrives by sync. The
   * group is returned rather than swallowed, so the screen can tell "no expenses" from
   * "expenses that sum to nothing" - the two states the spec's rule 11 conflates.
   */
  it('returns a group for a month whose expenses all sum to zero', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 0 },
      { id: 'e2', categoryId: ids.housing, amountMinor: 0 },
    );

    const rows = await october();

    expect(rows).toHaveLength(1);
    expect(sumOf(rows)).toBe(0);
    expect(countOf(rows)).toBe(2);
  });

  it('reads the same rows with no network of any kind', async () => {
    // Nothing in this path can reach one - there is no transport in the module graph at
    // all - so the assertion is the shape of the dependency rather than a mock. Kept as a
    // case because "works offline" is an acceptance criterion and this is the read it
    // names.
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses({ id: 'e1', categoryId: ids.housing, amountMinor: 52000 });

    expect(sumOf(await october())).toBe(52000);
  });
});
