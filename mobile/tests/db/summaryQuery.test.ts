import { migrate } from '@/db/migrations';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Measures the two SQL statements `docs/design/` names as the source of the two money
 * figures the app displays, against a real engine, before the screens that run them exist.
 *
 * These are **not** regression tripwires on product code - `TVO-11` and `TVO-12` have not
 * landed and no module here computes a month total. They characterise the *design's own*
 * queries: whether the statement each spec prints produces the result the same spec states
 * in prose. A green run says the measurement reproduces, not that a screen is correct. When
 * the real modules land, each case re-points at them and becomes a tripwire; until then the
 * value is that an implementer can run the finding rather than take it from a report.
 *
 * The fixtures are chosen so a right answer and a wrong one look different, which is the
 * failure `CAT-01` was filed for: the six seeded categories sort identically under every
 * ordering you might write, so a fixture built from them cannot separate them.
 */

/** `docs/design/08-monthly-summary.md` section Behaviour rule 1, verbatim. */
const SUMMARY_GROUPS = `
   SELECT categoryId, SUM(amountMinor) AS total, COUNT(*) AS n
   FROM expenses
   WHERE date BETWEEN ? AND ? AND deletedAt IS NULL
   GROUP BY categoryId
   ORDER BY total DESC
`;

/** `docs/design/04-expense-list.md` section Behaviour rule 3 - Home's total, the other figure. */
const HOME_TOTAL = `
   SELECT SUM(amountMinor) AS total
   FROM expenses
   WHERE date BETWEEN ? AND ? AND deletedAt IS NULL
`;

/**
 * The legend needs a name and a colour, which rule 1's statement does not select, so every
 * implementation has to join. This is the join the rest of the client already uses: live
 * rows only, which `queries.ts` states as the rule the UI must never break.
 */
const SUMMARY_LEGEND = `
   SELECT c.name, SUM(e.amountMinor) AS total, COUNT(*) AS n
   FROM expenses e
   JOIN categories c ON c.id = e.categoryId AND c.deletedAt IS NULL
   WHERE e.date BETWEEN ? AND ? AND e.deletedAt IS NULL
   GROUP BY c.id
   ORDER BY total DESC
`;

const OCTOBER: readonly [string, string] = ['2026-10-01', '2026-10-31'];
const AT = '2026-10-09T10:30:00.000Z';

interface SeedCategory {
  readonly id: string;
  readonly name: string;
  readonly deletedAt?: string;
}

interface SeedExpense {
  readonly id: string;
  readonly categoryId: string;
  readonly amountMinor: number;
  readonly date?: string;
}

const ids = {
  housing: '0192f5a0-0000-7000-8000-000000000011',
  groceries: '0192f5a0-0000-7000-8000-000000000012',
  rent: '0192f5a0-0000-7000-8000-000000000013',
  transport: '0192f5a0-0000-7000-8000-000000000014',
} as const;

describe('the design queries behind the two displayed totals', () => {
  let database: TestDatabase;
  let revision = 0;

  const pullCategories = async (...categories: readonly SeedCategory[]): Promise<void> => {
    for (const category of categories) {
      await database.runAsync(
        `INSERT INTO categories (id, name, color, isDefault, createdAt, updatedAt, deletedAt, revision)
         VALUES (?, ?, '#6B7280', 0, ?, ?, ?, ?)`,
        [category.id, category.name, AT, AT, category.deletedAt ?? null, (revision += 1)],
      );
    }
  };

  const pullExpenses = async (...expenses: readonly SeedExpense[]): Promise<void> => {
    for (const expense of expenses) {
      await database.runAsync(
        `INSERT INTO expenses (id, categoryId, amountMinor, currency, date, note, createdAt, updatedAt, deletedAt, revision)
         VALUES (?, ?, ?, 'USD', ?, NULL, ?, ?, NULL, ?)`,
        [
          expense.id,
          expense.categoryId,
          expense.amountMinor,
          expense.date ?? '2026-10-09',
          AT,
          AT,
          (revision += 1),
        ],
      );
    }
  };

  const homeTotal = async (): Promise<number | null> =>
    (await database.getFirstAsync<{ total: number | null }>(HOME_TOTAL, [...OCTOBER]))?.total ??
    null;

  beforeEach(async () => {
    database = createTestDatabase();
    revision = 0;
    await migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  it('SUM-15: rule 1 leaves a tie to the engine, where the default state specifies category name', async () => {
    await pullCategories(
      { id: ids.transport, name: 'Transport' },
      { id: ids.groceries, name: 'Groceries' },
      { id: ids.housing, name: 'Appliances' },
    );
    await pullExpenses(
      { id: 'e1', categoryId: ids.transport, amountMinor: 2000 },
      { id: 'e2', categoryId: ids.groceries, amountMinor: 2000 },
      { id: 'e3', categoryId: ids.housing, amountMinor: 2000 },
    );

    // Annotated rather than inferred: `ids` is `as const`, so an inferred key type is the
    // union of those three literals and a lookup by the `string` the query returns will
    // not typecheck.
    const byId = new Map<string, string>([
      [ids.transport, 'Transport'],
      [ids.groceries, 'Groceries'],
      [ids.housing, 'Appliances'],
    ]);
    const groups = await database.getAllAsync<{ categoryId: string; total: number }>(
      SUMMARY_GROUPS,
      [...OCTOBER],
    );
    const returned = groups.map((group) => byId.get(group.categoryId));

    // All three totals are 2000, so `ORDER BY total DESC` leaves the tie to whatever the
    // sorter happens to leave. The assertion is the negative on purpose: the exact order is
    // a property of the query plan, not of the data - pinning it would file a defect the
    // day SQLite or the index set changes. What is stable is that it is not the order the
    // `default` state states, "ties broken by category name ascending".
    expect(returned).not.toEqual(['Appliances', 'Groceries', 'Transport']);
  });

  it('SUM-16: the stated tiebreak, written against the uncollated name column, is case-sensitive', async () => {
    await pullCategories({ id: ids.transport, name: 'Transport' }, { id: ids.rent, name: 'rent' });
    await pullExpenses(
      { id: 'e1', categoryId: ids.transport, amountMinor: 2000 },
      { id: 'e2', categoryId: ids.rent, amountMinor: 2000 },
    );

    const rows = await database.getAllAsync<{ name: string }>(`${SUMMARY_LEGEND}, c.name`, [
      ...OCTOBER,
    ]);

    // `rent` sorts after `Transport` under BINARY collation: every capital precedes every
    // lowercase. This is GAP 12's defect, one layer up, in a query nobody has written yet.
    expect(rows.map((row) => row.name)).toEqual(['Transport', 'rent']);
  });

  it('SUM-17: an expense under a tombstoned category is in the Home total and not in the legend', async () => {
    await pullCategories(
      { id: ids.housing, name: 'Housing' },
      { id: ids.groceries, name: 'Groceries', deletedAt: AT },
    );
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 52000 },
      { id: 'e2', categoryId: ids.groceries, amountMinor: 31250 },
    );

    // Rule 1 groups by `categoryId` and never joins, so the orphan is a group of its own.
    const groups = await database.getAllAsync<{ categoryId: string; total: number }>(
      SUMMARY_GROUPS,
      [...OCTOBER],
    );
    expect(groups).toHaveLength(2);
    expect(groups.reduce((sum, group) => sum + group.total, 0)).toBe(83250);

    // The join every legend needs drops it, and a total summed from the legend - which
    // `SUM-07` asserts equals the displayed total - loses the orphan's amount with it.
    const legend = await database.getAllAsync<{ name: string; total: number }>(SUMMARY_LEGEND, [
      ...OCTOBER,
    ]);
    expect(legend.map((row) => row.name)).toEqual(['Housing']);
    expect(legend.reduce((sum, row) => sum + row.total, 0)).toBe(52000);

    // Home does not join at all, so the two tabs disagree by exactly the orphan.
    expect(await homeTotal()).toBe(83250);
  });

  it('SUM-18: a month of zero-amount expenses is neither empty nor chartable', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses(
      { id: 'e1', categoryId: ids.housing, amountMinor: 0 },
      { id: 'e2', categoryId: ids.housing, amountMinor: 0 },
      { id: 'e3', categoryId: ids.housing, amountMinor: 0 },
    );

    const groups = await database.getAllAsync<{ total: number; n: number }>(SUMMARY_GROUPS, [
      ...OCTOBER,
    ]);
    const monthTotal = groups.reduce((sum, group) => sum + group.total, 0);
    const count = groups.reduce((sum, group) => sum + group.n, 0);

    // Rule 11 draws the donut only when `monthTotal > 0` and calls that "the same condition
    // as the `empty` state". Here the two conditions disagree: there are three expenses, so
    // the month is not empty, and the total is zero, so no donut is drawn.
    expect(monthTotal).toBe(0);
    expect(count).toBe(3);
    expect(await homeTotal()).toBe(0);
  });

  it('SUM-19: an empty month returns no rows and a NULL total, not a zero', async () => {
    await pullCategories({ id: ids.housing, name: 'Housing' });
    await pullExpenses({
      id: 'e1',
      categoryId: ids.housing,
      amountMinor: 52000,
      date: '2026-09-30',
    });

    expect(await database.getAllAsync(SUMMARY_GROUPS, [...OCTOBER])).toEqual([]);

    // `SUM(...)` over no rows is NULL, not 0. Both specs state the total renders `$0.00`
    // rather than a blank, so the coalesce is the client's and has to be written.
    expect(await homeTotal()).toBeNull();
  });
});
