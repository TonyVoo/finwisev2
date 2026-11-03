import { screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { MONTH_LIMIT_TEST_ID } from '@/expenses/MonthTotal';
import { MONTH_PREVIOUS_TEST_ID } from '@/month/MonthSwitcher';
import {
  LIMIT_FIELD_TEST_ID,
  LIMIT_REMOVE_TEST_ID,
  LIMIT_SAVE_TEST_ID,
} from '@/limit/MonthlyLimitSheet';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
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

// 14 October 2026: day 14 of 31, so 18 days left counting today.
const NOW = new Date(2026, 9, 14, 9, 0, 0);

function seedWith(spent: number, limit?: string) {
  return async (database: SqliteDatabase): Promise<void> => {
    await writeUser(database, {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: 'ada@example.com',
      currency: 'USD',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await seedFallbackCategory(database);
    await seedCategory(database, { id: categoryId(1), name: 'Food', color: '#2F8044' });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(1),
      amountMinor: spent,
      date: '2026-10-10',
    });
    if (limit !== undefined) await writeMeta(database, META_KEYS.monthlyLimit, limit);
  };
}

const hidden = { includeHiddenElements: true };
const limitRow = () => within(screen.getByTestId('settings-monthly-limit', hidden));

beforeEach(() => resetRouter());

describe('the safe-to-spend line on Home', () => {
  it('is not there until a limit is set', async () => {
    await mountScreen(<ExpenseListScreen />, { clock: () => NOW, seed: seedWith(10000) });
    await screen.findByText(/This month|Total/);
    expect(screen.queryByTestId(MONTH_LIMIT_TEST_ID)).toBeNull();
  });

  it('says what is safe to spend today: what is left, divided by the days left', async () => {
    // $1,000.00 limit, $100.00 spent: $900.00 over 18 days = $50.00 a day.
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedWith(10000, '100000'),
    });
    await waitFor(() => expect(screen.queryByTestId(MONTH_LIMIT_TEST_ID)).not.toBeNull());
    expect(screen.getByTestId(MONTH_LIMIT_TEST_ID).props.children).toBe(
      COPY.monthlyLimit.safe.replace('{amount}', '$50.00'),
    );
  });

  it('says how far over once the limit is passed', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedWith(130000, '100000'),
    });
    await waitFor(() => expect(screen.queryByTestId(MONTH_LIMIT_TEST_ID)).not.toBeNull());
    expect(screen.getByTestId(MONTH_LIMIT_TEST_ID).props.children).toBe(
      COPY.monthlyLimit.over.replace('{amount}', '$300.00'),
    );
  });

  it('is for the month still going on, not for one that is over', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedWith(10000, '100000'),
    });
    await waitFor(() => expect(screen.queryByTestId(MONTH_LIMIT_TEST_ID)).not.toBeNull());

    await pressOn(MONTH_PREVIOUS_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(MONTH_LIMIT_TEST_ID)).toBeNull());
  });
});

describe('setting the limit in Settings', () => {
  it('shows "Not set", then saves what is typed and shows it', async () => {
    const { database } = await mountScreen(<SettingsScreen />, {
      clock: () => NOW,
      seed: seedWith(0),
    });
    await screen.findByTestId('settings-monthly-limit');
    expect(limitRow().getByText(COPY.monthlyLimit.none)).toBeTruthy();

    await userEvent.press(screen.getByTestId('settings-monthly-limit'));
    await typeInto(LIMIT_FIELD_TEST_ID, '1500');
    await pressOn(LIMIT_SAVE_TEST_ID);

    await waitFor(async () =>
      expect(await readMeta(database, META_KEYS.monthlyLimit)).toBe('150000'),
    );
    await waitFor(() => expect(limitRow().queryByText('$1,500.00')).not.toBeNull());
  });

  it('refuses text that is not an amount, and keeps the sheet open', async () => {
    const { database } = await mountScreen(<SettingsScreen />, {
      clock: () => NOW,
      seed: seedWith(0),
    });
    await userEvent.press(await screen.findByTestId('settings-monthly-limit'));
    await typeInto(LIMIT_FIELD_TEST_ID, 'lots');
    await pressOn(LIMIT_SAVE_TEST_ID);

    expect(await screen.findByText('Enter an amount like 40 or 40.50.')).toBeTruthy();
    expect(await readMeta(database, META_KEYS.monthlyLimit)).toBeNull();
  });

  it('removes the limit', async () => {
    const { database } = await mountScreen(<SettingsScreen />, {
      clock: () => NOW,
      seed: seedWith(0, '150000'),
    });
    await userEvent.press(await screen.findByTestId('settings-monthly-limit'));

    await pressOn(LIMIT_REMOVE_TEST_ID);

    await waitFor(async () => expect(await readMeta(database, META_KEYS.monthlyLimit)).toBe(''));
    await waitFor(() => expect(limitRow().queryByText(COPY.monthlyLimit.none)).not.toBeNull());
  });
});
