import { UNCATEGORIZED_NAME } from '@expense-tracker/shared';
import type { CategorySpend } from '@/db/queries';
import { legendRowLabel, summariseMonth } from '@/summary/summaryModel';
import { CATEGORY_RESERVED_COLOR, categoryColor } from '@/theme/tokens';

/**
 * The Summary's arithmetic: `src/summary/summaryModel.ts`.
 *
 * Everything asserted here is specified precisely by `docs/design/08-monthly-summary.md`
 * and is wrong in a way no screenshot reveals - a percentage that disagrees with its own
 * amount, a slice angle taken from a rounded label, a legend row for a category that spent
 * nothing. Driving it through a mounted chart would mean asserting on rendered text to find
 * out whether the division was right.
 *
 * The rows below are what `monthCategorySpend` returns, in the order it returns them
 * (amount descending, ties on name). `tests/db/monthCategorySpend.test.ts` is what pins
 * that order against a real engine; this suite is about what is done with it.
 */

function spend(
  name: string | null,
  totalMinor: number,
  overrides: Partial<CategorySpend> = {},
): CategorySpend {
  return {
    categoryId: name === null ? null : `cat-${name}`,
    name,
    // Null together with the name: both come off the same `COALESCE`, so a row with no
    // live category and no fallback has neither.
    color: name === null ? null : categoryColor.green,
    totalMinor,
    expenseCount: 1,
    ...overrides,
  };
}

describe('a month with nothing in it', () => {
  it('totals zero, counts zero and draws no chart', () => {
    const summary = summariseMonth([]);

    expect(summary).toEqual({
      totalMinor: 0,
      expenseCount: 0,
      entries: [],
      hasExpenses: false,
      isChartable: false,
    });
  });
});

describe('a month with spend in it', () => {
  it('totals and counts a single category', () => {
    const summary = summariseMonth([spend('Housing', 52000, { expenseCount: 3 })]);

    expect(summary.totalMinor).toBe(52000);
    expect(summary.expenseCount).toBe(3);
    expect(summary.isChartable).toBe(true);
    expect(summary.entries[0]?.percentLabel).toBe('100%');
    expect(summary.entries[0]?.share).toBe(1);
  });

  it('keeps the query order and the spec layout figures', () => {
    // The spec's own worked example, which is also the arithmetic a reader can check by
    // hand: `$1,284.50` across six categories at 40/24/15/11/6/3%.
    const summary = summariseMonth([
      spend('Housing', 52000),
      spend('Groceries', 31250),
      spend('Eating out', 19800),
      spend('Transport', 14200),
      spend('Bills', 7200),
      spend('Health', 4000),
    ]);

    expect(summary.totalMinor).toBe(128450);
    expect(summary.entries.map((entry) => [entry.name, entry.percentLabel])).toEqual([
      ['Housing', '40%'],
      ['Groceries', '24%'],
      ['Eating out', '15%'],
      ['Transport', '11%'],
      ['Bills', '6%'],
      ['Health', '3%'],
    ]);
  });

  it('sums minor units as integers', () => {
    // 0.10 + 0.20 + 0.01 is not 0.31 in floating point. Nothing here divides, so the total
    // is exact and the formatter at the edge is handed an integer.
    const summary = summariseMonth([spend('A', 10), spend('B', 20), spend('C', 1)]);

    expect(summary.totalMinor).toBe(31);
    expect(Number.isInteger(summary.totalMinor)).toBe(true);
  });

  it('takes the slice share from the exact ratio, not from the rounded label', () => {
    const summary = summariseMonth([spend('A', 2), spend('B', 1)]);

    // The labels round to 67% and 33%, which sum to 100 only by luck; the angles are the
    // true thirds (rule 3, last bullet).
    expect(summary.entries.map((entry) => entry.percentLabel)).toEqual(['67%', '33%']);
    expect(summary.entries[0]?.share).toBeCloseTo(2 / 3, 12);
    expect(summary.entries[1]?.share).toBeCloseTo(1 / 3, 12);
  });

  it('lets the displayed percentages fall short of 100 rather than fudging one', () => {
    const summary = summariseMonth([spend('A', 100), spend('B', 100), spend('C', 100)]);

    // Three thirds, each rounded independently: 33 + 33 + 33 = 99. The spec is explicit
    // that the screen does not correct this by adjusting the largest slice, "which would
    // make a legend row disagree with its own arithmetic". No 100% is displayed anywhere,
    // so nothing on screen contradicts anything else.
    expect(summary.entries.map((entry) => entry.percentLabel)).toEqual(['33%', '33%', '33%']);
  });

  it('shows a non-zero amount that rounds below one as <1%, never as 0%', () => {
    const summary = summariseMonth([spend('Housing', 100000), spend('Sweets', 49)]);

    // `round(49 * 100 / 100049)` is 0. An amount beside `0%` reads as a bug in the
    // arithmetic, so rule 3 requires the `<1%` form.
    expect(summary.entries[1]?.percentLabel).toBe('<1%');
    // And the slice still has its true angle, tiny as it is.
    expect(summary.entries[1]?.share).toBeCloseTo(49 / 100049, 12);
  });

  it('rounds a half up, so 0.5% is not <1%', () => {
    const summary = summariseMonth([spend('Housing', 199000), spend('Sweets', 1000)]);

    // `round(1000 * 100 / 200000)` is exactly 0.5, which rounds to 1. The boundary is
    // worth pinning: a `Math.floor` here would show `<1%` for an amount that is 1%.
    expect(summary.entries[1]?.percentLabel).toBe('1%');
  });

  it('drops a category that spent nothing from the legend and the chart', () => {
    const summary = summariseMonth([
      spend('Housing', 52000),
      // Reachable by sync: the server accepts `amountMinor: 0` on all four write paths, so
      // a category can hold expenses and no spend. A `$0.00 / 0%` row is noise
      // (state `empty` - a category with zero spend).
      spend('Gifts', 0, { expenseCount: 2 }),
    ]);

    expect(summary.entries.map((entry) => entry.name)).toEqual(['Housing']);
    // The expense still counts in the header, which is the figure Home's list agrees with.
    expect(summary.expenseCount).toBe(3);
    expect(summary.totalMinor).toBe(52000);
  });
});

/**
 * `SUM-18` and `TVO-31` item 4: `monthTotal > 0` and `empty` are not the same condition,
 * and the spec's rule 11 says they are. A month holding only zero-amount expenses is
 * neither chartable nor empty, and the state the spec leaves for it is a blank panel.
 */
describe('a month whose expenses sum to zero', () => {
  const summary = summariseMonth([spend('Housing', 0, { expenseCount: 2 }), spend('Gifts', 0)]);

  it('is not empty, because the expenses are real', () => {
    expect(summary.hasExpenses).toBe(true);
    expect(summary.expenseCount).toBe(3);
    expect(summary.totalMinor).toBe(0);
  });

  it('draws no donut, which is the guard against dividing by zero', () => {
    expect(summary.isChartable).toBe(false);
  });

  it('keeps its rows, with no percentage to state', () => {
    // Excluding zero-spend rows here would leave nothing between the total and the tab bar
    // - a blank panel in a state no part of the spec describes. The rows are shown instead,
    // and there is genuinely no share to put on them.
    expect(summary.entries.map((entry) => [entry.name, entry.percentLabel, entry.share])).toEqual([
      ['Housing', null, null],
      ['Gifts', null, null],
    ]);
  });
});

describe('an expense whose category is gone entirely', () => {
  // `name` and `color` are null only when the category is tombstoned *and* there is no live
  // fallback to fold into - a broken invariant a buggy peer can produce. The amount is
  // money the user spent either way.
  const summary = summariseMonth([spend(null, 31250)]);

  it('is named with the contract seed name rather than left blank', () => {
    expect(summary.entries[0]?.name).toBe(UNCATEGORIZED_NAME);
  });

  it('wears the reserved colour, so the slice and its swatch still have one', () => {
    // §Accessibility rule 4: colour is never the only carrier of identity here, and rule 5
    // separates slices by a stroke - both assume every slice has a colour at all.
    expect(summary.entries[0]?.color).toBe(CATEGORY_RESERVED_COLOR);
  });

  it('still counts toward the month', () => {
    expect(summary.totalMinor).toBe(31250);
  });
});

describe('the legend row a screen reader hears', () => {
  const summary = summariseMonth([spend('Housing', 52000), spend('Sweets', 49)]);

  it('reads the name, the formatted amount and the share', () => {
    // Deck §8: `{name}, {amount}, {percent} percent of the month`. The amount is the
    // formatted currency string - a screen reader must never reach `52000`, which it would
    // read as "fifty-two thousand".
    expect(legendRowLabel(summary.entries[0]!, 'USD', 'en-US')).toBe(
      'Housing, $520.00, 100 percent of the month',
    );
  });

  it('says less than one percent in words for the <1% row', () => {
    expect(legendRowLabel(summary.entries[1]!, 'USD', 'en-US')).toBe(
      'Sweets, $0.49, less than 1 percent of the month',
    );
    // Not the glyph: `<1%` is read as "less than one percent" by neither screen reader
    // reliably, and by TalkBack as nothing at all.
    expect(legendRowLabel(summary.entries[1]!, 'USD', 'en-US')).not.toContain('<');
  });

  it('omits the share, and its separator, when the month has none', () => {
    const zeroMonth = summariseMonth([spend('Housing', 0)]);

    expect(legendRowLabel(zeroMonth.entries[0]!, 'USD', 'en-US')).toBe('Housing, $0.00');
  });

  it('formats in the currency it is given', () => {
    // Single currency per user, captured at signup, and every amount on every screen is
    // formatted in it (`docs/PLAN.md` §Data model). The symbol is not hardcoded anywhere,
    // and neither is the number of decimals: the same 52000 minor units are `$520.00` in a
    // two-decimal currency and `¥52,000` in a zero-decimal one.
    expect(legendRowLabel(summary.entries[0]!, 'JPY', 'en-US')).toBe(
      'Housing, ¥52,000, 100 percent of the month',
    );
  });
});
