import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { writeUser } from '@/db/user';
import { isSearchActive, searchExpenses, searchSummary } from '@/db/queries';
import type { SqliteDatabase } from '@/db/sqlite';
import SearchScreen from '../../app/(app)/search';
import { resetRouter } from '../support/router';
import { mountScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/** Search can be narrowed to the expenses you kept private, in a household only. */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const ME = '0192f5a0-0000-7000-8000-00000000a001';
const BAO = '0192f5a0-0000-7000-8000-00000000b001';
const PRIVATE_CHIP = 'search-chip-private';

async function seed(database: SqliteDatabase, inHousehold: boolean): Promise<void> {
  await writeUser(database, {
    id: ME,
    email: 'ada@example.com',
    displayName: null,
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: GROCERIES,
    amountMinor: 1250,
    date: '2026-10-14',
    note: 'Milk',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: GROCERIES,
    amountMinor: 900,
    date: '2026-10-13',
    note: 'Gift',
  });
  await database.runAsync('UPDATE expenses SET private = 1 WHERE id = ?', [expenseId(2)]);
  if (inHousehold) {
    await writeMeta(
      database,
      META_KEYS.householdMembers,
      JSON.stringify([
        { userId: ME, email: 'ada@example.com', displayName: null },
        { userId: BAO, email: 'bao@example.com', displayName: null },
      ]),
    );
  }
}

beforeEach(() => resetRouter());

describe('private search queries', () => {
  it('counts the private-only filter as an active search', () => {
    expect(isSearchActive({ text: '', categoryId: null, privateOnly: true })).toBe(true);
    expect(isSearchActive({ text: '', categoryId: null, privateOnly: false })).toBe(false);
  });

  it('narrows rows and the summary to private expenses', async () => {
    const { database } = await mountScreen(<SearchScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, true),
    });
    const rows = await searchExpenses(database, { text: '', categoryId: null, privateOnly: true });
    expect(rows.map((row) => row.id)).toEqual([expenseId(2)]);
    expect(
      await searchSummary(database, { text: '', categoryId: null, privateOnly: true }),
    ).toEqual({ count: 1, totalMinor: 900 });
  });

  it('combines with text', async () => {
    const { database } = await mountScreen(<SearchScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, true),
    });
    const rows = await searchExpenses(database, {
      text: 'milk',
      categoryId: null,
      privateOnly: true,
    });
    expect(rows).toEqual([]);
  });
});

describe('the Private chip', () => {
  it('is absent outside a household', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed: (db) => seed(db, false) });
    await waitFor(() => expect(screen.queryByTestId('search-input')).not.toBeNull());
    expect(screen.queryByTestId(PRIVATE_CHIP)).toBeNull();
  });

  it('lists only private expenses when selected, and releases when tapped again', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed: (db) => seed(db, true) });
    await waitFor(() => expect(screen.queryByTestId(PRIVATE_CHIP)).not.toBeNull());
    expect(screen.getByText(COPY.home.search.private)).toBeTruthy();

    fireEvent.press(screen.getByTestId(PRIVATE_CHIP));
    await waitFor(() => expect(screen.queryByText('Gift')).not.toBeNull());
    expect(screen.queryByText('Milk')).toBeNull();
    expect(screen.getByTestId(PRIVATE_CHIP).props.accessibilityState.selected).toBe(true);

    fireEvent.press(screen.getByTestId(PRIVATE_CHIP));
    await waitFor(() => expect(screen.queryByTestId('search-prompt')).not.toBeNull());
  });

  it('lets you pick private expenses and share them again from the results', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed: (db) => seed(db, true) });
    await waitFor(() => expect(screen.queryByTestId(PRIVATE_CHIP)).not.toBeNull());
    fireEvent.press(screen.getByTestId(PRIVATE_CHIP));
    await waitFor(() => expect(screen.queryByText('Gift')).not.toBeNull());

    fireEvent(screen.getByTestId(`expense-row-${expenseId(2)}`), 'longPress');
    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    fireEvent.press(screen.getByTestId('selection-make-shared'));

    await waitFor(() => expect(screen.queryByText('Gift')).toBeNull());
    expect(screen.getByText(COPY.household.bulk.madeSharedOne)).toBeTruthy();
  });

  it('has a Select button of its own, only in a household', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed: (db) => seed(db, true) });
    await waitFor(() => expect(screen.queryByTestId(PRIVATE_CHIP)).not.toBeNull());

    fireEvent.press(screen.getByTestId('search-select'));

    await waitFor(() => expect(screen.queryByTestId('selection-bar')).not.toBeNull());
    expect(screen.queryByTestId('search-select')).toBeNull();
  });

  it('has no Select button outside a household', async () => {
    await mountScreen(<SearchScreen />, { clock: () => NOW, seed: (db) => seed(db, false) });
    await waitFor(() => expect(screen.queryByTestId('search-input')).not.toBeNull());

    expect(screen.queryByTestId('search-select')).toBeNull();
  });
});
