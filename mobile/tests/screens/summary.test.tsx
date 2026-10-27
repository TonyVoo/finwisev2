import { screen, waitFor } from '@testing-library/react-native';
import { COPY, EMPTY_COPY } from '@/copy/strings';
import { createExpense } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { writeLastSyncedAt } from '@/sync/cursor';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import { MONTH_NEXT_TEST_ID, MONTH_PREVIOUS_TEST_ID } from '@/month/MonthSwitcher';
import { DONUT_CENTRE_TEST_ID, DONUT_TEST_ID } from '@/summary/CategoryDonut';
import { LEGEND_ROW_TEST_ID_PREFIX, LEGEND_TEST_ID } from '@/summary/SpendLegend';
import {
  TREND_BAR_TEST_ID_PREFIX,
  TREND_INCOME_BAR_TEST_ID_PREFIX,
  TREND_LEGEND_TEST_ID,
  TREND_TEST_ID,
} from '@/summary/SpendTrend';
import { SUMMARY_EMPTY_TEST_ID } from '@/summary/SummaryStates';
import { categoryColor } from '@/theme/tokens';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import { mountScreen, pressOn, type MountedScreen } from '../support/mount';
import { resetRouter, routerRecord } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';
import { LARGE_FONT_SCALE, setFontScale } from '../support/fontScale';
import { PIE_SLICE_TEST_ID, POLAR_CHART_TEST_ID } from '../support/victoryNative';

jest.mock('expo-router');

/**
 * The Summary tab: `docs/design/08-monthly-summary.md`.
 *
 * Driven over a real container - a real SQLite engine with the real migrations, the real
 * aggregate query and the real query cache. Two things are stood in for: the router, and
 * the Skia chart renderer (`tests/support/victoryNative.tsx`, which explains what that
 * does and does not cover). The transport is the default from `mountScreen`, which
 * **fails the test if it is called** - this screen is specified to compute every figure
 * from local SQLite, so a request escaping it would be the offline promise breaking, and
 * every case below passes with no network available at all.
 *
 * The figures asserted on are deliberately the spec's own worked example, so a reader can
 * check them by hand: `$1,284.50` across six categories at 40/24/15/11/6/3%.
 */

/** 14 October 2026. Local components, so the suite's timezone cannot move the day. */
const NOW = new Date(2026, 9, 14, 9, 0, 0);

const HOUSING = categoryId(1);
const GROCERIES = categoryId(2);
const TRANSPORT = categoryId(3);
const EATING_OUT = categoryId(4);
const BILLS = categoryId(5);
const HEALTH = categoryId(6);

async function seedUser(database: SqliteDatabase, currency = 'USD'): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  // An account that has synced before: an empty store is then a true empty, not "not loaded
  // yet" (`useAwaitingFirstSync`).
  await writeLastSyncedAt(database, '2026-10-16T08:00:00.000Z');
}

/**
 * The spec's worked example, as rows: six categories summing to `$1,284.50` across seven
 * expenses, plus one expense back in September.
 *
 * The amounts are exactly the six in `08-monthly-summary.md`'s wireframe, so the
 * percentages the screen computes are the 40/24/15/11/6/3 printed there and a reader can
 * check any figure below against the spec by eye. Groceries is two expenses rather than
 * one, so the count is not merely the number of categories and a `GROUP BY` that dropped
 * rows within a group would show up.
 *
 * The first and the last day of the month are both occupied (Housing on the 1st, Transport
 * on the 31st): these are the boundary rows, and they are in the *screen's* fixture rather
 * than only the query's so that a half-open range gone wrong at either end fails here too.
 */
async function seedOctober(database: SqliteDatabase): Promise<void> {
  await seedUser(database);
  await seedFallbackCategory(database);
  await seedCategory(database, { id: HOUSING, name: 'Housing', color: categoryColor.blue });
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: categoryColor.green });
  await seedCategory(database, { id: TRANSPORT, name: 'Transport', color: categoryColor.orange });
  await seedCategory(database, { id: EATING_OUT, name: 'Eating out', color: categoryColor.indigo });
  await seedCategory(database, { id: BILLS, name: 'Bills', color: categoryColor.teal });
  await seedCategory(database, { id: HEALTH, name: 'Health', color: categoryColor.red });

  await seedExpense(database, {
    id: expenseId(1),
    categoryId: HOUSING,
    amountMinor: 52000,
    date: '2026-10-01',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: GROCERIES,
    amountMinor: 14250,
    date: '2026-10-09',
  });
  await seedExpense(database, {
    id: expenseId(3),
    categoryId: GROCERIES,
    amountMinor: 17000,
    date: '2026-10-14',
  });
  await seedExpense(database, {
    id: expenseId(4),
    categoryId: TRANSPORT,
    amountMinor: 14200,
    date: '2026-10-31',
  });
  await seedExpense(database, {
    id: expenseId(6),
    categoryId: EATING_OUT,
    amountMinor: 19800,
    date: '2026-10-05',
  });
  await seedExpense(database, {
    id: expenseId(7),
    categoryId: BILLS,
    amountMinor: 7200,
    date: '2026-10-20',
  });
  await seedExpense(database, {
    id: expenseId(8),
    categoryId: HEALTH,
    amountMinor: 4000,
    date: '2026-10-22',
  });
  // Another month entirely: nothing from it may appear in October's figures.
  await seedExpense(database, {
    id: expenseId(5),
    categoryId: HOUSING,
    amountMinor: 999900,
    date: '2026-09-30',
  });
}

async function mountSummary(
  seed?: (database: SqliteDatabase) => Promise<void>,
): Promise<MountedScreen> {
  const mounted = await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
  // The first SQLite read resolves a tick after mount; every case asserts settled state.
  await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
  return mounted;
}

/** The total block's composed label, which is what a screen reader hears. */
function totalLabel(): string {
  return screen.getByTestId(MONTH_TOTAL_TEST_ID).props.accessibilityLabel as string;
}

function legendLabels(): string[] {
  return screen
    .queryAllByTestId(new RegExp(`^${LEGEND_ROW_TEST_ID_PREFIX}-`))
    .map((row) => row.props.accessibilityLabel as string);
}

/** The data the chart was handed, one entry per slice, in the order it was handed over. */
function slices(): string[] {
  return screen
    .queryAllByTestId(PIE_SLICE_TEST_ID, { includeHiddenElements: true })
    .map((slice) => slice.props.accessibilityValue.text as string);
}

beforeEach(() => {
  resetRouter();
});

describe('a month with spend in it', () => {
  it('shows the total, the count, the chart and a legend row per category', async () => {
    await mountSummary(seedOctober);

    // One aggregate feeds all of it (rule 1), so these four assertions are the same
    // arithmetic read four ways and cannot disagree.
    expect(totalLabel()).toBe('Total this month, $1,284.50, 7 expenses');
    expect(legendLabels()).toEqual([
      'Housing, $520.00, 40 percent of the month',
      'Groceries, $312.50, 24 percent of the month',
      'Eating out, $198.00, 15 percent of the month',
      'Transport, $142.00, 11 percent of the month',
      'Bills, $72.00, 6 percent of the month',
      'Health, $40.00, 3 percent of the month',
    ]);
    expect(screen.queryByTestId(DONUT_TEST_ID, { includeHiddenElements: true })).not.toBeNull();
    expect(slices()).toEqual([
      `Housing:52000:${categoryColor.blue}`,
      `Groceries:31250:${categoryColor.green}`,
      `Eating out:19800:${categoryColor.indigo}`,
      `Transport:14200:${categoryColor.orange}`,
      `Bills:7200:${categoryColor.teal}`,
      `Health:4000:${categoryColor.red}`,
    ]);
  });

  it('gives each legend row its category icon', async () => {
    await mountSummary(seedOctober);

    const icons = screen.queryAllByTestId('swatch-icon', { includeHiddenElements: true });
    expect(icons).toHaveLength(6);
  });

  it('draws the slices in legend order, largest first', async () => {
    await mountSummary(seedOctober);

    // Rule 4: the ring is read from 12 o'clock clockwise in the same order as the list
    // beneath it, so the largest slice is immediately readable and the two agree.
    const legendOrder = legendLabels().map((label) => label.split(',')[0]);
    const sliceOrder = slices().map((slice) => slice.split(':')[0]);

    expect(sliceOrder).toEqual(legendOrder);
    expect(sliceOrder).toEqual([
      'Housing',
      'Groceries',
      'Eating out',
      'Transport',
      'Bills',
      'Health',
    ]);
  });

  it('repeats the total inside the ring, with the month under it', async () => {
    await mountSummary(seedOctober);

    const centre = screen.getByTestId(DONUT_CENTRE_TEST_ID, { includeHiddenElements: true });

    // Element 9, and the figure is the same one the header shows - so `exact: false`,
    // because the two lines concatenate to `$1,284.50October` and the assertion is about
    // each line being present rather than about the pair having no separator between them.
    expect(centre).toHaveTextContent('$1,284.50', { exact: false });
    expect(centre).toHaveTextContent('October', { exact: false });
  });

  it('hides the whole chart from assistive technology', async () => {
    await mountSummary(seedOctober);

    // §Accessibility rule 1: an SVG donut cannot be read usefully, so the legend is its
    // accessible equivalent and the chart is skipped entirely. Both props, because the
    // first is iOS and the second Android.
    const donut = screen.getByTestId(DONUT_TEST_ID, { includeHiddenElements: true });
    expect(donut.props.accessibilityElementsHidden).toBe(true);
    expect(donut.props.importantForAccessibility).toBe('no-hide-descendants');
    // And it is genuinely unreachable without opting in, which is how a screen reader
    // sees it.
    expect(screen.queryByTestId(POLAR_CHART_TEST_ID)).toBeNull();
  });

  it('reads an amount as money and never as a bare number', async () => {
    await mountSummary(seedOctober);

    // `52000` read aloud is "fifty-two thousand", which is a different number from the one
    // on screen. Every amount in a label is the formatted string (deck §8).
    for (const label of [totalLabel(), ...legendLabels()]) {
      expect(label).toMatch(/\$[\d,]+\.\d{2}/);
    }
  });

  it('excludes a soft-deleted expense from every figure', async () => {
    await mountSummary(async (database) => {
      await seedOctober(database);
      await seedExpense(database, {
        id: expenseId(9),
        categoryId: TRANSPORT,
        amountMinor: 500000,
        date: '2026-10-12',
        deletedAt: '2026-10-13T08:00:00.000Z',
      });
    });

    // A tombstone big enough that including it would be unmissable in the total, the
    // count, the legend row and the slice.
    expect(totalLabel()).toBe('Total this month, $1,284.50, 7 expenses');
    expect(legendLabels()[3]).toBe('Transport, $142.00, 11 percent of the month');
    expect(slices()[3]).toBe(`Transport:14200:${categoryColor.orange}`);
  });

  it('counts an expense that has never synced, exactly like one that has', async () => {
    await mountSummary(async (database) => {
      await seedOctober(database);
      // The real write path, so this row carries an outbox entry and is `pending`. State
      // `offline-pending`: it is included in the total, the chart and the legend, because
      // it is a real expense that exists locally. The chart shows no per-slice indicator -
      // a slice is an aggregate, and marking it would imply something about the category.
      await createExpense(database, {
        categoryId: TRANSPORT,
        amountMinor: 1550,
        currency: 'USD',
        date: '2026-10-14',
      });
    });

    expect(totalLabel()).toBe('Total this month, $1,300.00, 8 expenses');
    expect(legendLabels()[3]).toBe('Transport, $157.50, 12 percent of the month');
  });

  it('folds an expense whose category was deleted into the fallback row', async () => {
    await mountSummary(async (database) => {
      await seedOctober(database);
      await database.runAsync('UPDATE categories SET deletedAt = ? WHERE id = ?', [
        '2026-10-13T08:00:00.000Z',
        GROCERIES,
      ]);
    });

    // `TVO-31` item 1: the money stays on screen and stays in the total, under a row that
    // has a name and a colour. Dropping it - which the join the legend needs would do
    // unless it folds - would show `$972.00` here and `$1,284.50` on the Expenses tab.
    expect(totalLabel()).toBe('Total this month, $1,284.50, 7 expenses');
    expect(legendLabels()).toEqual([
      'Housing, $520.00, 40 percent of the month',
      'Uncategorized, $312.50, 24 percent of the month',
      'Eating out, $198.00, 15 percent of the month',
      'Transport, $142.00, 11 percent of the month',
      'Bills, $72.00, 6 percent of the month',
      'Health, $40.00, 3 percent of the month',
    ]);
  });

  it('formats every amount in the user currency, decimals included', async () => {
    await mountSummary(async (database) => {
      await seedOctober(database);
      await database.runAsync('UPDATE user SET currency = ?', ['JPY']);
      await database.runAsync('UPDATE expenses SET currency = ?', ['JPY']);
    });

    // A zero-decimal currency: the same stored integers, no fraction digits, and no
    // hardcoded dollar sign anywhere on the screen.
    expect(totalLabel()).toBe('Total this month, ¥128,450, 7 expenses');
    expect(legendLabels()[0]).toBe('Housing, ¥52,000, 40 percent of the month');
  });
});

/**
 * §Accessibility rule 6. These cases exist because the suite's baseline is now the
 * ordinary text scale (`tests/support/fontScale.ts`): the large-text layouts used to be
 * the *only* ones rendered, by accident of the jest preset, and would otherwise have gone
 * from always-tested to never-tested.
 *
 * What each asserts is that scaling up removes a *duplicate*, never a fact.
 */
describe('with the text size turned up', () => {
  it('drops the ring centre rather than shrinking it twice', async () => {
    setFontScale(LARGE_FONT_SCALE);
    await mountSummary(seedOctober);

    // The centre label is the only text inside the chart, and the same figure is already
    // on screen at `type.display` directly above it. Above 1.5 the honest answer is to
    // show it once rather than squeeze a second copy into a 180px ring.
    expect(screen.queryByTestId(DONUT_CENTRE_TEST_ID, { includeHiddenElements: true })).toBeNull();
    // The ring itself stays, and so does the figure it was repeating.
    expect(screen.queryByTestId(DONUT_TEST_ID, { includeHiddenElements: true })).not.toBeNull();
    expect(totalLabel()).toBe('Total this month, $1,284.50, 7 expenses');
  });

  it('says exactly the same thing once the legend rows stack', async () => {
    setFontScale(LARGE_FONT_SCALE);
    await mountSummary(seedOctober);

    // Above 1.3 a row lays its name on one line and its figures on the next, so the name
    // is not squeezed to an ellipsis by the two figures beside it. That is a layout
    // change and nothing else: a screen reader hears one element per row, with the same
    // composed label, at every text size.
    expect(legendLabels()).toEqual([
      'Housing, $520.00, 40 percent of the month',
      'Groceries, $312.50, 24 percent of the month',
      'Eating out, $198.00, 15 percent of the month',
      'Transport, $142.00, 11 percent of the month',
      'Bills, $72.00, 6 percent of the month',
      'Health, $40.00, 3 percent of the month',
    ]);
  });
});

describe('a month with nothing in it', () => {
  it('explains itself, and still shows the zero', async () => {
    await mountSummary(async (database) => {
      await seedUser(database);
      await seedFallbackCategory(database);
      await seedCategory(database, { id: HOUSING, name: 'Housing' });
      await seedExpense(database, {
        id: expenseId(1),
        categoryId: HOUSING,
        amountMinor: 52000,
        date: '2026-09-15',
      });
    });

    expect(screen.getByText(EMPTY_COPY.summary.headline)).not.toBeNull();
    expect(screen.getByText(EMPTY_COPY.summary.body)).not.toBeNull();
    // The figure is not hidden here: "hiding it would make the number appear to pop into
    // existence later", and `0 expenses` is the plural form.
    expect(totalLabel()).toBe('Total this month, $0.00, 0 expenses');
  });

  it('draws no ring and no legend at all', async () => {
    await mountSummary(seedUser);

    // A zero-value donut is never drawn: an empty ring reads as a loading state or a bug
    // (state `empty`), and it is also what would divide by zero in the percentages.
    expect(screen.queryByTestId(DONUT_TEST_ID, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId(LEGEND_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(SUMMARY_EMPTY_TEST_ID)).not.toBeNull();
  });

  it('offers no add action, so the Expenses tab keeps the one entry point', async () => {
    await mountSummary(seedUser);

    // Deliberate (state `empty`): duplicating the FAB on a summary screen would be a
    // second, competing way in.
    expect(screen.queryByLabelText(COPY.home.fab)).toBeNull();
  });
});

/**
 * `SUM-18` and `TVO-31` item 4. The spec's rule 11 claims `monthTotal > 0` and `empty` are
 * the same condition; a month holding only zero-amount expenses satisfies neither, and the
 * state it lands in is a blank panel the spec does not describe. The screen shows the rows.
 */
describe('a month whose expenses sum to zero', () => {
  it('is not the empty state, and draws no ring', async () => {
    await mountSummary(async (database) => {
      await seedUser(database);
      await seedFallbackCategory(database);
      await seedCategory(database, { id: HOUSING, name: 'Housing' });
      // Reachable by sync: the server accepts `amountMinor: 0` on all four write paths,
      // even though this app's own form disables Save at zero.
      await seedExpense(database, {
        id: expenseId(1),
        categoryId: HOUSING,
        amountMinor: 0,
        date: '2026-10-02',
      });
    });

    expect(totalLabel()).toBe('Total this month, $0.00, 1 expense');
    expect(screen.queryByTestId(SUMMARY_EMPTY_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(DONUT_TEST_ID, { includeHiddenElements: true })).toBeNull();
    // The row is there, with no percentage, rather than a blank panel between the total
    // and the tab bar.
    expect(legendLabels()).toEqual(['Housing, $0.00']);
  });
});

describe('the month this screen is looking at', () => {
  it('follows the shared switcher, and relabels the total off the current month', async () => {
    await mountSummary(seedOctober);

    await pressOn(MONTH_PREVIOUS_TEST_ID);

    // September holds the one 999900 expense. `Total`, not `Total this month`: a past month
    // labelled "this month" would be a plain lie about which figure is on screen.
    await waitFor(() => expect(totalLabel()).toBe('Total, $9,999.00, 1 expense'));
    expect(legendLabels()).toEqual(['Housing, $9,999.00, 100 percent of the month']);
  });

  it('comes back to the same figures', async () => {
    await mountSummary(seedOctober);

    await pressOn(MONTH_PREVIOUS_TEST_ID);
    await waitFor(() => expect(totalLabel()).toBe('Total, $9,999.00, 1 expense'));
    await pressOn(MONTH_NEXT_TEST_ID);

    await waitFor(() => expect(totalLabel()).toBe('Total this month, $1,284.50, 7 expenses'));
  });

  it('opens the picker rather than navigating a month at a time', async () => {
    await mountSummary(seedOctober);

    // The same route Home pushes: the picker is the only path to a non-adjacent month
    // (`05-month-switcher.md` rule 4), and both tabs share the selection it writes.
    await pressOn('month-label');

    expect(routerRecord.push).toContain('/(app)/month-picker');
  });
});

describe('with no network available at all', () => {
  it('computes every figure anyway', async () => {
    // `mountScreen`'s default transport throws if anything calls it, so reaching the
    // assertions is the evidence. This is the acceptance criterion "works offline", and it
    // is a property of where the data comes from rather than of a mocked response.
    const { requests } = await mountSummary(seedOctober);

    expect(totalLabel()).toBe('Total this month, $1,284.50, 7 expenses');
    expect(requests).toEqual([]);
  });
});

describe('the trend card', () => {
  it('shows six months ending at the selected one, each bar labelled with its amount', async () => {
    await mountSummary(seedOctober);

    expect(screen.queryByTestId(TREND_TEST_ID)).not.toBeNull();
    const bars = screen.queryAllByTestId(new RegExp(`^${TREND_BAR_TEST_ID_PREFIX}-`));
    expect(bars.map((bar) => bar.props.accessibilityLabel as string)).toEqual([
      'May 2026, $0.00',
      'June 2026, $0.00',
      'July 2026, $0.00',
      'August 2026, $0.00',
      'September 2026, $9,999.00',
      'October 2026, $1,284.50',
    ]);
  });

  it('adds an income bar per month, a legend and spoken income once there is income', async () => {
    await mountSummary(async (database) => {
      await seedOctober(database);
      await seedExpense(database, {
        id: expenseId(90),
        categoryId: HOUSING,
        kind: 'income',
        amountMinor: 500000,
        date: '2026-10-05',
      });
    });

    expect(screen.queryByTestId(TREND_LEGEND_TEST_ID)).not.toBeNull();
    const income = screen.queryAllByTestId(new RegExp(`^${TREND_INCOME_BAR_TEST_ID_PREFIX}-`));
    expect(income).toHaveLength(6);
    const october = screen.getByTestId(`${TREND_BAR_TEST_ID_PREFIX}-2026-10`);
    expect(october.props.accessibilityLabel).toBe(
      'October 2026, Spent $1,284.50, Income $5,000.00',
    );
  });

  it('shows no income bars or legend without income', async () => {
    await mountSummary(seedOctober);

    expect(screen.queryByTestId(TREND_LEGEND_TEST_ID)).toBeNull();
    expect(
      screen.queryAllByTestId(new RegExp(`^${TREND_INCOME_BAR_TEST_ID_PREFIX}-`)),
    ).toHaveLength(0);
  });

  it('is left out when only one month has spend', async () => {
    await mountSummary(async (database) => {
      await seedUser(database);
      await seedFallbackCategory(database);
      await seedCategory(database, { id: HOUSING, name: 'Housing', color: categoryColor.blue });
      await seedExpense(database, {
        id: expenseId(1),
        categoryId: HOUSING,
        amountMinor: 1000,
        date: '2026-10-02',
      });
    });

    expect(screen.queryByTestId(TREND_TEST_ID)).toBeNull();
  });
});
