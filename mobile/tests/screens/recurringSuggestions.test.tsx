import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, readMeta } from '@/db/meta';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { SUGGESTION_TEST_ID_PREFIX } from '@/recurring/SuggestionCard';
import RecurringScreen from '../../app/(app)/settings/recurring';
import { mountScreen, pressOn } from '../support/mount';
import { resetRouter } from '../support/router';
import {
  categoryId,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 3, 9, 0, 0); // 3 November 2026
const FUN = categoryId(1);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'VND',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FUN, name: 'Fun', color: '#5B57C7' });
  ['2026-08-05', '2026-09-05', '2026-10-05'].forEach((date, i) =>
    seedExpense(database, {
      id: expenseId(i + 1),
      categoryId: FUN,
      amountMinor: 260000,
      currency: 'VND',
      date,
      note: 'Netflix',
    }),
  );
}

beforeEach(() => resetRouter());

describe('suggestions on the Recurring screen', () => {
  it('offers a payment that has repeated every month, and says how it was noticed', async () => {
    await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });

    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_TEST_ID_PREFIX}-0`)).not.toBeNull(),
    );
    expect(screen.getByText('Netflix')).toBeTruthy();
    expect(screen.getByText(/around day 5 each month/)).toBeTruthy();
    expect(screen.getByText('paid 3 months in a row')).toBeTruthy();
  });

  it('adds a monthly rule that starts at the next payment, and the suggestion goes', async () => {
    const { database } = await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_TEST_ID_PREFIX}-add-0`)).not.toBeNull(),
    );

    await pressOn(`${SUGGESTION_TEST_ID_PREFIX}-add-0`);

    await waitFor(async () =>
      expect((await outboxEntries(database)).some((e) => e.entity === 'recurring')).toBe(true),
    );
    const rule = (await outboxEntries(database)).find((e) => e.entity === 'recurring');
    expect(JSON.parse(rule?.fields ?? '{}')).toMatchObject({
      categoryId: FUN,
      amountMinor: 260000,
      note: 'Netflix',
      frequency: 'monthly',
      startDate: '2026-11-05',
    });
    await waitFor(() => expect(screen.queryByTestId(`${SUGGESTION_TEST_ID_PREFIX}-0`)).toBeNull());
    // Nothing was back-filled: the earlier payments are already in the history.
    expect((await outboxEntries(database)).filter((e) => e.entity === 'expense')).toEqual([]);
    expect(screen.getByText(COPY.recurringSuggestions.added)).toBeTruthy();
  });

  it('forgets a suggestion on Not now, and does not ask again', async () => {
    const { database } = await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_TEST_ID_PREFIX}-dismiss-0`)).not.toBeNull(),
    );

    await userEvent.press(screen.getByTestId(`${SUGGESTION_TEST_ID_PREFIX}-dismiss-0`));

    await waitFor(() => expect(screen.queryByTestId(`${SUGGESTION_TEST_ID_PREFIX}-0`)).toBeNull());
    expect(await readMeta(database, META_KEYS.recurringDismissed)).toContain('netflix');
    expect(await outboxEntries(database)).toEqual([]);
  });
});
