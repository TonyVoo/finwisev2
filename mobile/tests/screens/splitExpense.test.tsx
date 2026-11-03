import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import { NOTE_ROW_TEST_ID, SAVE_TEST_ID, SPLIT_ROW_TEST_ID } from '@/expenses/ExpenseFormScreen';
import { NOTE_DONE_TEST_ID, NOTE_INPUT_TEST_ID } from '@/expenses/NoteSheet';
import {
  SPLIT_AMOUNT_TEST_ID_PREFIX,
  SPLIT_CATEGORY_TEST_ID_PREFIX,
  SPLIT_DONE_TEST_ID,
  SPLIT_LEFT_TEST_ID,
  SPLIT_SHEET_TEST_ID,
} from '@/expenses/SplitSheet';
import NewExpenseScreen from '../../app/(app)/expense/new';
import { mountScreen, pressOn, typeInto } from '../support/mount';
import { resetRouter } from '../support/router';
import { categoryId, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 3, 9, 0, 0);
const FOOD = categoryId(1);
const HOME = categoryId(2);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', color: '#2F8044' });
  await seedCategory(database, { id: HOME, name: 'Household', color: '#2F6FD0' });
}

async function mountWithAmount(keys: string) {
  const mounted = await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  await userEvent.press(screen.getByTestId('amount-display'));
  for (const key of keys) await userEvent.press(screen.getByTestId(`keypad-${key}`));
  await pressOn('keypad-done');
  return mounted;
}

async function openSplit() {
  await userEvent.press(screen.getByTestId(SPLIT_ROW_TEST_ID));
  await waitFor(() => expect(screen.queryByTestId(SPLIT_SHEET_TEST_ID)).not.toBeNull());
}

const left = () => screen.getByTestId(SPLIT_LEFT_TEST_ID).props.children as string;

beforeEach(() => resetRouter());

describe('splitting an expense', () => {
  it('is offered once there is an amount, and not before', async () => {
    await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
    expect(screen.queryByTestId(SPLIT_ROW_TEST_ID)).toBeNull();

    await userEvent.press(screen.getByTestId('amount-display'));
    await userEvent.press(screen.getByTestId('keypad-5'));
    await pressOn('keypad-done');

    expect(screen.getByTestId(SPLIT_ROW_TEST_ID)).toBeTruthy();
  });

  it('says how much is left to assign as the parts are typed', async () => {
    await mountWithAmount('500');
    await openSplit();
    expect(left()).toBe(COPY.split.left.replace('{amount}', '$5.00'));

    await typeInto(`${SPLIT_AMOUNT_TEST_ID_PREFIX}-0`, '3');
    expect(left()).toBe(COPY.split.left.replace('{amount}', '$2.00'));

    await typeInto(`${SPLIT_AMOUNT_TEST_ID_PREFIX}-0`, '7');
    expect(left()).toBe(COPY.split.over.replace('{amount}', '$2.00'));
  });

  it('will not finish until the parts add up and every part has a category', async () => {
    await mountWithAmount('500');
    await openSplit();
    await typeInto(`${SPLIT_AMOUNT_TEST_ID_PREFIX}-0`, '3');
    await userEvent.press(screen.getByTestId(`${SPLIT_CATEGORY_TEST_ID_PREFIX}-0-${FOOD}`));

    // The second part has no category yet.
    await pressOn(SPLIT_DONE_TEST_ID);
    expect(screen.queryByTestId(SPLIT_SHEET_TEST_ID)).not.toBeNull();
    expect(screen.getByText(COPY.split.reasonCategory)).toBeTruthy();
  });

  it('saves one entry per part, same day and note, summing to the total', async () => {
    const { database } = await mountWithAmount('5000');
    await userEvent.press(screen.getByTestId(NOTE_ROW_TEST_ID));
    await typeInto(NOTE_INPUT_TEST_ID, 'Supermarket');
    await pressOn(NOTE_DONE_TEST_ID);

    await openSplit();
    await userEvent.press(screen.getByTestId(`${SPLIT_CATEGORY_TEST_ID_PREFIX}-0-${FOOD}`));
    await typeInto(`${SPLIT_AMOUNT_TEST_ID_PREFIX}-0`, '35');
    await userEvent.press(screen.getByTestId(`${SPLIT_CATEGORY_TEST_ID_PREFIX}-1-${HOME}`));
    await pressOn(SPLIT_DONE_TEST_ID); // the second part takes the rest: $15.00
    await waitFor(() => expect(screen.queryByTestId(SPLIT_SHEET_TEST_ID)).toBeNull());

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect((await outboxEntries(database)).filter((e) => e.entity === 'expense')).toHaveLength(2),
    );
    const saved = (await outboxEntries(database))
      .filter((e) => e.entity === 'expense')
      .map((e) => JSON.parse(e.fields) as Record<string, unknown>);
    expect(saved.map((e) => [e['categoryId'], e['amountMinor']]).sort()).toEqual(
      [
        [FOOD, 3500],
        [HOME, 1500],
      ].sort(),
    );
    expect(saved.every((e) => e['note'] === 'Supermarket' && e['date'] === '2026-11-03')).toBe(
      true,
    );
    expect(await screen.findByText(COPY.split.saved.replace('{count}', '2'))).toBeTruthy();
  });

  it('is dropped if the total changes afterwards, since the parts would no longer add up', async () => {
    await mountWithAmount('500');
    await openSplit();
    await typeInto(`${SPLIT_AMOUNT_TEST_ID_PREFIX}-0`, '3');
    await userEvent.press(screen.getByTestId(`${SPLIT_CATEGORY_TEST_ID_PREFIX}-0-${FOOD}`));
    await userEvent.press(screen.getByTestId(`${SPLIT_CATEGORY_TEST_ID_PREFIX}-1-${HOME}`));
    await pressOn(SPLIT_DONE_TEST_ID);
    expect(screen.getByText('2 categories')).toBeTruthy();

    await userEvent.press(screen.getByTestId('amount-display'));
    await pressOn('keypad-1');

    await waitFor(() => expect(screen.queryByText('2 categories')).toBeNull());
  });
});
