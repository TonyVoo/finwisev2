import { screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, readMeta } from '@/db/meta';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { writeLastSyncedAt } from '@/sync/cursor';
import {
  SUGGEST_ALL_TEST_ID,
  SUGGEST_LATER_TEST_ID,
  SUGGEST_LIMIT_TEST_ID,
  SUGGEST_TEST_ID,
  SUGGEST_USE_PREFIX,
} from '@/summary/BudgetSuggestionsCard';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import { mountScreen, pressOn } from '../support/mount';
import { resetRouter } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/** 14 November 2026: the three months before it are August, September and October. */
const NOW = new Date(2026, 10, 14, 9, 0, 0);
const FOOD = categoryId(1);
const FUN = categoryId(2);

async function seed(database: SqliteDatabase, foodBudget: number | null = null): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await writeLastSyncedAt(database, '2026-11-14T08:00:00.000Z');
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', monthlyBudgetMinor: foodBudget });
  await seedCategory(database, { id: FUN, name: 'Fun' });
  let n = 1;
  for (const [month, food, fun] of [
    ['2026-08', 30000, 5000],
    ['2026-09', 32000, 0],
    ['2026-10', 28000, 0],
  ] as const) {
    await seedExpense(database, {
      id: expenseId(n++),
      categoryId: FOOD,
      amountMinor: food,
      date: `${month}-10`,
    });
    if (fun > 0)
      await seedExpense(database, {
        id: expenseId(n++),
        categoryId: FUN,
        amountMinor: fun,
        date: `${month}-12`,
      });
  }
}

beforeEach(() => resetRouter());

describe('suggested budgets on the Summary', () => {
  it('offers a budget for a category with a few months of spending, and none for a one-off', async () => {
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });

    await waitFor(() => expect(screen.queryByTestId(SUGGEST_TEST_ID)).not.toBeNull());
    // Food averages 300.00; plus 5% is 315.00, rounded up to 320.00.
    expect(screen.getByText(/Food: .*320\.00 a month/)).toBeTruthy();
    expect(screen.queryByTestId(`${SUGGEST_USE_PREFIX}-${FUN}`)).toBeNull();
  });

  it('sets the budget only when the person taps Use', async () => {
    const { database } = await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGEST_USE_PREFIX}-${FOOD}`)).not.toBeNull(),
    );
    const before = await database.getFirstAsync<{ monthlyBudgetMinor: number | null }>(
      'SELECT monthlyBudgetMinor FROM categories WHERE id = ?',
      [FOOD],
    );
    expect(before?.monthlyBudgetMinor).toBeNull();

    await pressOn(`${SUGGEST_USE_PREFIX}-${FOOD}`);

    await waitFor(async () => {
      const row = await database.getFirstAsync<{ monthlyBudgetMinor: number | null }>(
        'SELECT monthlyBudgetMinor FROM categories WHERE id = ?',
        [FOOD],
      );
      expect(row?.monthlyBudgetMinor).toBe(32000);
    });
    const outbox = await database.getAllAsync<{ entity: string }>('SELECT entity FROM outbox', []);
    expect(outbox.some((row) => row.entity === 'category')).toBe(true);
    await waitFor(() => expect(screen.queryByText(COPY.summary.suggest.applied)).not.toBeNull());
  });

  it('offers a limit for the whole month, and sets it on Use', async () => {
    const { database } = await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(SUGGEST_LIMIT_TEST_ID)).not.toBeNull());

    await pressOn(SUGGEST_LIMIT_TEST_ID);

    await waitFor(async () =>
      expect(await readMeta(database, META_KEYS.monthlyLimit)).not.toBeNull(),
    );
  });

  it('leaves a budget alone that is already about right', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, 32000),
    });
    await waitFor(() => expect(screen.queryByTestId(SUGGEST_TEST_ID)).not.toBeNull());
    expect(screen.queryByTestId(`${SUGGEST_USE_PREFIX}-${FOOD}`)).toBeNull();
  });

  it('puts the card away for the month on Not now, and remembers it', async () => {
    const { database } = await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(SUGGEST_LATER_TEST_ID)).not.toBeNull());

    await pressOn(SUGGEST_LATER_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(SUGGEST_TEST_ID)).toBeNull());
    expect(await readMeta(database, META_KEYS.budgetSuggestDismissed)).toBe('2026-11');
  });

  it('Use all sets every budget offered', async () => {
    const { database } = await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(SUGGEST_ALL_TEST_ID)).not.toBeNull());

    await pressOn(SUGGEST_ALL_TEST_ID);

    await waitFor(async () => {
      const row = await database.getFirstAsync<{ monthlyBudgetMinor: number | null }>(
        'SELECT monthlyBudgetMinor FROM categories WHERE id = ?',
        [FOOD],
      );
      expect(row?.monthlyBudgetMinor).toBe(32000);
    });
  });
});
