import { act, cleanup, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { writeUser } from '@/db/user';
import { escapeLike, searchExpenses, searchSummary } from '@/db/queries';
import type { SqliteDatabase } from '@/db/sqlite';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import { resetRouter } from '../support/router';
import { mountScreen, type MountedScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const TRANSPORT = categoryId(2);

async function seedData(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#22C55E' });
  await seedCategory(database, { id: TRANSPORT, name: 'Transport', color: '#3B82F6' });
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: GROCERIES,
    amountMinor: 1250,
    date: '2026-10-14',
    note: 'Milk, eggs',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: TRANSPORT,
    amountMinor: 320,
    date: '2026-10-14',
  });
  // An older month: search must reach it even though October is selected.
  await seedExpense(database, {
    id: expenseId(3),
    categoryId: GROCERIES,
    amountMinor: 2400,
    date: '2026-03-02',
    note: 'Dentist 50% off',
  });
}

async function mountHome(): Promise<MountedScreen> {
  const mounted = await mountScreen(<ExpenseListScreen />, { clock: () => NOW, seed: seedData });
  await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
  return mounted;
}

beforeEach(() => {
  resetRouter();
});

describe('search queries', () => {
  it('escapes LIKE wildcards so user text matches literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('matches notes and category names, across months, newest first', async () => {
    const { database } = await mountHome();
    const byNote = await searchExpenses(database, { text: 'dentist', categoryId: null });
    expect(byNote.map((r) => r.id)).toEqual([expenseId(3)]);

    const byCategory = await searchExpenses(database, { text: 'grocer', categoryId: null });
    expect(byCategory.map((r) => r.id)).toEqual([expenseId(1), expenseId(3)]);
  });

  it('treats % in the text literally', async () => {
    const { database } = await mountHome();
    expect(
      (await searchExpenses(database, { text: '50%', categoryId: null })).map((r) => r.id),
    ).toEqual([expenseId(3)]);
    expect(await searchExpenses(database, { text: '%', categoryId: null })).toHaveLength(1);
  });

  it('combines text and category with AND, and summarises all matches', async () => {
    const { database } = await mountHome();
    expect(await searchExpenses(database, { text: 'milk', categoryId: TRANSPORT })).toHaveLength(0);
    expect(await searchSummary(database, { text: '', categoryId: GROCERIES })).toEqual({
      count: 2,
      totalMinor: 3650,
    });
  });

  it('excludes soft-deleted expenses', async () => {
    const { database } = await mountHome();
    await database.runAsync(
      `UPDATE expenses SET deletedAt = '2026-10-10T00:00:00.000Z' WHERE id = ?`,
      [expenseId(3)],
    );
    expect(await searchExpenses(database, { text: 'dentist', categoryId: null })).toHaveLength(0);
  });
});

describe('the Home search UI', () => {
  it('finds an expense in another month, then restores the month view on close', async () => {
    await mountHome();

    await userEvent.press(screen.getByTestId('home-search'));
    expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).toBeNull();

    fireEvent.changeText(screen.getByTestId('search-input'), 'dentist');
    expect(await screen.findByText('Dentist 50% off', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText('Milk, eggs')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('search-summary').props.children).toContain('1 result'),
    );

    await userEvent.press(screen.getByTestId('home-search'));
    await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
    expect(screen.getByText('Milk, eggs')).toBeTruthy();
    expect(screen.queryByText('Dentist 50% off')).toBeNull();
  });

  it('filters by a category chip and shows an empty state for no matches', async () => {
    await mountHome();
    await userEvent.press(screen.getByTestId('home-search'));

    await userEvent.press(screen.getByTestId(`search-chip-${TRANSPORT}`));
    await waitFor(() => expect(screen.queryByText('$3.20')).not.toBeNull());
    expect(screen.queryByText('Milk, eggs')).toBeNull();

    fireEvent.changeText(screen.getByTestId('search-input'), 'zzzz');
    expect(await screen.findByTestId('empty-search', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('does nothing for whitespace-only text', async () => {
    await mountHome();
    await userEvent.press(screen.getByTestId('home-search'));
    fireEvent.changeText(screen.getByTestId('search-input'), '   ');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(screen.queryByTestId('search-summary')).toBeNull();
    expect(screen.queryByTestId('empty-search')).toBeNull();
    cleanup();
  });
});
