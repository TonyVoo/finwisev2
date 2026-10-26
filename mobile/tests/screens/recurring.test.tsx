import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY, SNACK_COPY } from '@/copy/strings';
import type { SqliteDatabase } from '@/db/sqlite';
import RecurringScreen, {
  RECURRING_DELETE_DIALOG_TEST_ID,
  RECURRING_ROW_TEST_ID_PREFIX,
} from '../../app/(app)/settings/recurring';
import { resetRouter } from '../support/router';
import { mountScreen } from '../support/mount';
import { categoryId, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 9, 26, 9, 0, 0);
const RENT = categoryId(1);

async function seed(database: SqliteDatabase): Promise<void> {
  await seedFallbackCategory(database);
  await seedCategory(database, { id: RENT, name: 'Rent' });
}

/** Open a date row and pick `date` from the grid, stepping months from the one shown. */
async function pickDate(
  row: string,
  date: string,
  monthsBack = 0,
  monthsForward = 0,
): Promise<void> {
  await userEvent.press(screen.getByTestId(row));
  await userEvent.press(screen.getByTestId('date-choose'));
  for (let i = 0; i < monthsBack; i += 1) {
    await userEvent.press(screen.getByTestId('date-grid-previous'));
  }
  for (let i = 0; i < monthsForward; i += 1) {
    await userEvent.press(screen.getByTestId('date-grid-next'));
  }
  await userEvent.press(screen.getByTestId(`date-day-${date}`));
}

async function fillAndSubmit(fields: {
  amount: string;
  monthsBack: number;
  monthsForward?: number;
  start: string;
}): Promise<void> {
  await userEvent.press(screen.getByTestId('recurring-fab'));
  await act(async () => {
    screen.getByTestId('recurring-amount').props.onChangeText(fields.amount);
  });
  await userEvent.press(screen.getByTestId(`recurring-category-${RENT}`));
  await userEvent.press(screen.getByTestId('recurring-frequency-monthly'));
  await pickDate('recurring-start', fields.start, fields.monthsBack, fields.monthsForward ?? 0);
  await userEvent.press(screen.getByTestId('recurring-submit'));
}

beforeEach(() => {
  resetRouter();
});

describe('the recurring screen', () => {
  it('shows the empty state when there are no rules', async () => {
    await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });

    await waitFor(() => expect(screen.queryByTestId('recurring-empty')).not.toBeNull());
    expect(screen.getByText(COPY.recurring.empty.headline)).toBeTruthy();
  });

  it('saves a rule, queues it, and backfills the expenses already due', async () => {
    const { database } = await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });

    // 26 Aug and 26 Sep and 26 Oct have all passed or are today: three occurrences.
    await fillAndSubmit({ amount: '900', start: '2026-08-26', monthsBack: 2 });

    await waitFor(() => expect(screen.queryByText(SNACK_COPY.recurring.saved)).not.toBeNull());

    const expenses = await database.getAllAsync<{ date: string; amountMinor: number }>(
      'SELECT date, amountMinor FROM expenses ORDER BY date',
      [],
    );
    expect(expenses).toEqual([
      { date: '2026-08-26', amountMinor: 90000 },
      { date: '2026-09-26', amountMinor: 90000 },
      { date: '2026-10-26', amountMinor: 90000 },
    ]);

    const entities = (await outboxEntries(database)).map((entry) => entry.entity);
    expect(entities.filter((e) => e === 'recurring')).toHaveLength(1);
    expect(entities.filter((e) => e === 'expense')).toHaveLength(3);
  });

  it('lets a rule start in the future, and says nothing is added yet', async () => {
    const { database } = await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });

    await fillAndSubmit({ amount: '900', start: '2026-11-05', monthsBack: 0, monthsForward: 1 });
    await waitFor(() => expect(screen.queryByText(SNACK_COPY.recurring.saved)).not.toBeNull());

    expect(await database.getAllAsync('SELECT id FROM expenses', [])).toHaveLength(0);
    expect(await database.getAllAsync('SELECT id FROM recurring', [])).toHaveLength(1);
  });

  it('refuses an end date before the start date', async () => {
    const { database } = await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });

    await userEvent.press(screen.getByTestId('recurring-fab'));
    await act(async () => {
      screen.getByTestId('recurring-amount').props.onChangeText('10');
    });
    await pickDate('recurring-end', '2026-11-30', 0, 1);
    await pickDate('recurring-start', '2026-12-05', 0, 2);
    await userEvent.press(screen.getByTestId('recurring-submit'));

    expect(screen.queryByText(COPY.recurring.error.endBeforeStart)).not.toBeNull();
    expect(await outboxEntries(database)).toHaveLength(0);
  });

  it('deletes the rule but keeps what it already added', async () => {
    const { database } = await mountScreen(<RecurringScreen />, { clock: () => NOW, seed });
    await fillAndSubmit({ amount: '900', start: '2026-10-26', monthsBack: 0 });
    await waitFor(() => expect(screen.queryByText(SNACK_COPY.recurring.saved)).not.toBeNull());

    const row = await waitFor(() => {
      const node = screen
        .getAllByRole('button')
        .find((n) => String(n.props.testID ?? '').startsWith(RECURRING_ROW_TEST_ID_PREFIX));
      if (node === undefined) throw new Error('row not rendered yet');
      return node;
    });
    await act(async () => {
      row.props.onAccessibilityAction?.({ nativeEvent: { actionName: 'delete' } });
    });
    // Whichever path opens the dialog, confirm through it.
    await waitFor(() =>
      expect(screen.queryByTestId(RECURRING_DELETE_DIALOG_TEST_ID)).not.toBeNull(),
    );
    await userEvent.press(screen.getByTestId(`${RECURRING_DELETE_DIALOG_TEST_ID}-confirm`));

    await waitFor(() => expect(screen.queryByText(SNACK_COPY.recurring.deleted)).not.toBeNull());
    const rules = await database.getAllAsync<{ deletedAt: string | null }>(
      'SELECT deletedAt FROM recurring',
      [],
    );
    expect(rules[0]?.deletedAt).not.toBeNull();
    const live = await database.getAllAsync('SELECT id FROM expenses WHERE deletedAt IS NULL', []);
    expect(live).toHaveLength(1);
  });
});
