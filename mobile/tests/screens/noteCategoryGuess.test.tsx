import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import { CATEGORY_ROW_TEST_ID, NOTE_ROW_TEST_ID } from '@/expenses/ExpenseFormScreen';
import { NOTE_DONE_TEST_ID, NOTE_INPUT_TEST_ID } from '@/expenses/NoteSheet';
import NewExpenseScreen from '../../app/(app)/expense/new';
import { mountScreen, pressOn, typeInto } from '../support/mount';
import { resetRouter } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 3, 9, 0, 0);
const FUEL = categoryId(1);
const FOOD = categoryId(2);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FUEL, name: 'Fuel', color: '#B3261E' });
  await seedCategory(database, { id: FOOD, name: 'Food', color: '#2F8044' });
  await seedCategory(database, { id: categoryId(3), name: 'Transport', color: '#2F6FD0' });
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: FUEL,
    amountMinor: 4000,
    date: '2026-10-20',
    note: 'Shell',
  });
  // The most recent entry, so the form opens on Food and Fuel can only come from the note.
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: FOOD,
    amountMinor: 900,
    date: '2026-10-25',
    note: 'Lunch',
  });
}

const categoryLabel = () =>
  screen.getByTestId(CATEGORY_ROW_TEST_ID, { includeHiddenElements: true }).props
    .accessibilityLabel as string;

async function mount() {
  const mounted = await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  return mounted;
}

async function typeNote(text: string) {
  await userEvent.press(screen.getByTestId(NOTE_ROW_TEST_ID));
  await typeInto(NOTE_INPUT_TEST_ID, text);
  await pressOn(NOTE_DONE_TEST_ID);
}

beforeEach(() => resetRouter());

describe('a note that has been filed before', () => {
  it('files the new entry under the same category, and says so', async () => {
    await mount();
    expect(categoryLabel()).toContain('Food');

    await typeNote('shell');

    await waitFor(() => expect(categoryLabel()).toContain('Fuel'));
    expect(
      await screen.findByText('Filed under Fuel, like your earlier "shell" entries.'),
    ).toBeTruthy();
  });

  it('leaves a category the person chose alone', async () => {
    await mount();
    await userEvent.press(screen.getByTestId(CATEGORY_ROW_TEST_ID));
    await userEvent.press(screen.getByText('Transport'));
    expect(categoryLabel()).toContain('Transport');

    await typeNote('Shell');

    expect(categoryLabel()).toContain('Transport');
  });

  it('does nothing for a note that has not been seen', async () => {
    await mount();
    const before = categoryLabel();

    await typeNote('Something new');

    expect(categoryLabel()).toBe(before);
  });
});
