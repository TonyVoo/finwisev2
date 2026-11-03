import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import {
  FILTER_CLEAR_TEST_ID,
  FILTER_MAX_TEST_ID,
  FILTER_MIN_TEST_ID,
  FILTER_SAVE_NAME_TEST_ID,
  FILTER_SAVE_TEST_ID,
  FILTERS_SHEET_TEST_ID,
  SAVED_SEARCH_TEST_ID_PREFIX,
} from '@/search/FiltersSheet';
import SearchScreen from '../../app/(app)/search';
import { resetRouter } from '../support/router';
import { mountScreen, pressOn, typeInto } from '../support/mount';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 3, 9, 0, 0);
const FOOD = categoryId(1);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', color: '#2F8044' });
  const add = (n: number, amountMinor: number, date: string, extra: object = {}) =>
    seedExpense(database, { id: expenseId(n), categoryId: FOOD, amountMinor, date, ...extra });
  await add(1, 500, '2026-10-10', { note: 'Tea' });
  await add(2, 2500, '2026-10-12', { note: 'Lunch' });
  await add(3, 12000, '2026-11-01', { note: 'Groceries' });
  await add(4, 90000, '2026-11-02', { kind: 'income', note: 'Pay' });
}

beforeEach(() => resetRouter());

async function openFilters() {
  await pressOn('search-chip-filters');
  await waitFor(() => expect(screen.queryByTestId(FILTERS_SHEET_TEST_ID)).not.toBeNull());
}
const hidden = { includeHiddenElements: true };
const summary = () => screen.queryByTestId('search-summary', hidden);
const results = () => screen.getByTestId('search-summary', hidden).props.children as string;

describe('search filters', () => {
  it('shows a Filters chip, and nothing is searched until one is used', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed });
    expect(screen.getByText(COPY.searchFilters.filters)).toBeTruthy();
    expect(summary()).toBeNull();
  });

  it('narrows by type, with the badge counting it', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed });
    await openFilters();

    await pressOn('filter-kind-income');

    await waitFor(() => expect(summary()).not.toBeNull());
    await waitFor(() => expect(results()).toMatch(/1 result/));
    expect(screen.getByText(`${COPY.searchFilters.filters} · 1`, hidden)).toBeTruthy();
  });

  it('narrows by amount range and by date preset', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed });
    await openFilters();

    await typeInto(FILTER_MIN_TEST_ID, '10');
    await typeInto(FILTER_MAX_TEST_ID, '200');
    await waitFor(() => expect(results()).toMatch(/2 results/)); // 25.00 and 120.00

    await pressOn('filter-range-thisMonth');
    await waitFor(() => expect(results()).toMatch(/1 result/)); // only November's 120.00
    expect(results()).toContain('$120.00');
  });

  it('clears the filters', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed });
    await openFilters();
    await pressOn('filter-kind-income');
    await waitFor(() => expect(summary()).not.toBeNull());

    await pressOn(FILTER_CLEAR_TEST_ID);

    await waitFor(() => expect(summary()).toBeNull());
  });

  it('saves a search, and applies it again later', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed });
    await openFilters();
    await pressOn('filter-kind-expense');
    await typeInto(FILTER_MIN_TEST_ID, '10');
    await typeInto(FILTER_SAVE_NAME_TEST_ID, 'Big spends');
    await pressOn(FILTER_SAVE_TEST_ID);
    await waitFor(() =>
      expect(screen.queryByTestId(`${SAVED_SEARCH_TEST_ID_PREFIX}-0`)).not.toBeNull(),
    );

    await pressOn(FILTER_CLEAR_TEST_ID);
    await pressOn(`${SAVED_SEARCH_TEST_ID_PREFIX}-0`);

    await waitFor(() => expect(screen.queryByTestId(FILTERS_SHEET_TEST_ID)).toBeNull());
    await waitFor(() => expect(results()).toMatch(/2 results/)); // 25.00 and 120.00
    expect(screen.getByText(`${COPY.searchFilters.filters} · 2`, hidden)).toBeTruthy();
  });

  it('removes a saved search', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed });
    await openFilters();
    await typeInto(FILTER_SAVE_NAME_TEST_ID, 'Temp');
    await pressOn(FILTER_SAVE_TEST_ID);
    await waitFor(() =>
      expect(screen.queryByTestId(`${SAVED_SEARCH_TEST_ID_PREFIX}-0`)).not.toBeNull(),
    );

    await userEvent.press(screen.getByTestId(`${SAVED_SEARCH_TEST_ID_PREFIX}-remove-0`));

    await waitFor(() =>
      expect(screen.queryByTestId(`${SAVED_SEARCH_TEST_ID_PREFIX}-0`)).toBeNull(),
    );
  });
});
