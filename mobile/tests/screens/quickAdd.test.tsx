import { screen, userEvent, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import {
  CATEGORY_ROW_TEST_ID,
  DATE_ROW_TEST_ID,
  NOTE_ROW_TEST_ID,
  SAVE_TEST_ID,
} from '@/expenses/ExpenseFormScreen';
import { dateRowLabel } from '@/lib/calendar';
import {
  QUICK_ADD_FILL_TEST_ID,
  QUICK_ADD_INPUT_TEST_ID,
  QUICK_ADD_SUGGESTION_DISMISS_TEST_ID,
  QUICK_ADD_SUGGESTION_TEST_ID,
  QUICK_ADD_SUGGESTION_USE_TEST_ID,
} from '@/quickAdd/QuickAddLine';
import NewExpenseScreen from '../../app/(app)/expense/new';
import EditExpenseScreen from '../../app/(app)/expense/[id]';
import { resetRouter, setSearchParams } from '../support/router';
import { mountScreen, type MountedScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * Quick add on the expense form (`docs/design/15-quick-add.md`): a "Describe it" line above the form.
 * Fill reads the sentence on the phone and offers a suggestion; nothing reaches a field until Use,
 * nothing is saved until Save, and the network is never touched (every request fails the test).
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const EATING_OUT = categoryId(2);

async function seedBasics(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
  await seedCategory(database, { id: EATING_OUT, name: 'Eating out', color: '#C45A1A' });
}

async function noNetwork(request: TransportRequest): Promise<TransportResponse> {
  throw new Error(`unexpected request ${request.method} ${request.path}`);
}

async function mountAdd(): Promise<MountedScreen> {
  const mounted = await mountScreen(<NewExpenseScreen />, {
    clock: () => NOW,
    seed: seedBasics,
    transport: noNetwork,
  });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  return mounted;
}

async function typeAndFill(text: string) {
  await userEvent.type(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), text);
  await userEvent.press(screen.getByTestId(QUICK_ADD_FILL_TEST_ID));
}

const label = (testID: string) =>
  screen.getByTestId(testID, { includeHiddenElements: true }).props.accessibilityLabel as string;

beforeEach(() => resetRouter());

describe('the Describe it line', () => {
  it('is on Add expense, says what it reads, and starts empty', async () => {
    await mountAdd();

    expect(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID).props.value).toBe('');
    expect(screen.getByPlaceholderText(COPY.form.quickAdd.placeholder)).toBeTruthy();
    expect(screen.getByText(COPY.form.quickAdd.hint)).toBeTruthy();
    expect(screen.getByLabelText(COPY.form.quickAdd.fill)).toBeTruthy();
  });

  it('is not there when editing an existing expense', async () => {
    setSearchParams({ id: expenseId(1) });
    await mountScreen(<EditExpenseScreen />, {
      clock: () => NOW,
      seed: async (database) => {
        await seedBasics(database);
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 500,
          date: '2026-10-13',
        });
      },
      transport: noNetwork,
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

    expect(screen.queryByTestId(QUICK_ADD_INPUT_TEST_ID)).toBeNull();
  });
});

describe('Fill', () => {
  it('shows a suggestion card and changes no field', async () => {
    const { requests } = await mountAdd();

    await typeAndFill('coffee 4.50 yesterday');

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(screen.getByText(COPY.form.quickAdd.suggestionTitle)).toBeTruthy();
    expect(screen.getByText(/\$4\.50 · .* · Coffee/)).toBeTruthy();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
    expect(label(NOTE_ROW_TEST_ID)).not.toContain('Coffee');
    expect(requests).toEqual([]);
  });

  it('fills the fields on Use, empties the line, and still saves nothing until Save', async () => {
    const { database } = await mountAdd();
    await typeAndFill('coffee 4.50 yesterday');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('4.50');
    expect(label(DATE_ROW_TEST_ID)).toContain(dateRowLabel('2026-10-13', '2026-10-14'));
    expect(label(NOTE_ROW_TEST_ID)).toContain('Coffee');
    expect(label(CATEGORY_ROW_TEST_ID)).toContain('Eating out');
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
    expect(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID).props.value).toBe('');
    expect(await outboxEntries(database)).toEqual([]);
  });

  it('saves what was used, as an ordinary expense', async () => {
    const { database } = await mountAdd();
    await typeAndFill('coffee 4.50 yesterday');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect((await outboxEntries(database)).some((entry) => entry.entity === 'expense')).toBe(
        true,
      ),
    );
    const entry = (await outboxEntries(database)).find((row) => row.entity === 'expense');
    expect(JSON.parse(entry?.fields ?? '{}')).toMatchObject({
      kind: 'expense',
      amountMinor: 450,
      date: '2026-10-13',
      note: 'Coffee',
      categoryId: EATING_OUT,
    });
  });

  it('turns the form to income for a salary', async () => {
    await mountAdd();
    await typeAndFill('salary 3000');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(screen.getByTestId('kind-toggle-income').props.accessibilityState.selected).toBe(true);
    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('3,000.00');
  });

  it('leaves every field alone on Dismiss, keeping what was typed', async () => {
    await mountAdd();
    await typeAndFill('coffee 4.50');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_DISMISS_TEST_ID));

    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
    expect(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID).props.value).toBe('coffee 4.50');
  });

  it('drops the suggestion as soon as the sentence changes, since it no longer describes it', async () => {
    await mountAdd();
    await typeAndFill('coffee 4.50');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.type(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), '0');

    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });

  it('says so, instead of guessing, when it cannot tell the amount, and still offers the rest', async () => {
    await mountAdd();
    await typeAndFill('coffee 4.50 tip 1.00');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    expect(screen.getByText(new RegExp(COPY.form.quickAdd.noAmount))).toBeTruthy();
    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
    expect(label(CATEGORY_ROW_TEST_ID)).toContain('Eating out');
  });

  it('says it could not read a sentence with nothing in it, and shows no card', async () => {
    await mountAdd();

    await typeAndFill('!!!');

    await waitFor(() => expect(screen.getByText(COPY.form.quickAdd.nothingFound)).toBeTruthy());
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });

  it('asks for a sentence when the line is empty', async () => {
    await mountAdd();

    await userEvent.press(screen.getByTestId(QUICK_ADD_FILL_TEST_ID));

    await waitFor(() => expect(screen.getByText(COPY.form.quickAdd.empty)).toBeTruthy());
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });
});
