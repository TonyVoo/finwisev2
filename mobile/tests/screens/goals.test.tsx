import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { createGoal } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import GoalsScreen, { GOAL_ROW_TEST_ID_PREFIX } from '../../app/(app)/settings/goals';
import { resetRouter } from '../support/router';
import { mountScreen } from '../support/mount';
import { seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 9, 26, 9, 0, 0);
const GOAL_ID = '0192f5a0-0000-7000-8000-0000000000a1';
const hidden = { includeHiddenElements: true };

async function seed(database: SqliteDatabase): Promise<void> {
  await seedFallbackCategory(database);
  await createGoal(
    database,
    { name: 'Holiday', targetMinor: 100000, savedMinor: 0, currency: 'USD', deadline: null },
    { id: GOAL_ID },
  );
}

async function deposit(amount: string): Promise<void> {
  await userEvent.press(screen.getByTestId(`${GOAL_ROW_TEST_ID_PREFIX}-${GOAL_ID}`));
  await act(async () => {
    screen.getByTestId('deposit-amount').props.onChangeText(amount);
  });
  await userEvent.press(screen.getByTestId('deposit-submit'));
  // Let the progress bar finish easing inside act, rather than after the test ends.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

beforeEach(() => {
  resetRouter();
  jest.clearAllMocks();
});

describe('the savings goals screen', () => {
  it('shows a goal with a target badge while it is being saved towards', async () => {
    await mountScreen(<GoalsScreen />, { clock: () => NOW, seed });

    await waitFor(() =>
      expect(screen.queryByTestId(`${GOAL_ROW_TEST_ID_PREFIX}-${GOAL_ID}`)).not.toBeNull(),
    );
    expect(screen.getByText('Holiday')).toBeTruthy();
    expect(screen.getByTestId('goal-badge-target', hidden)).toBeTruthy();
  });

  it('records a deposit with a success buzz and a confirmation', async () => {
    const { database } = await mountScreen(<GoalsScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${GOAL_ROW_TEST_ID_PREFIX}-${GOAL_ID}`)).not.toBeNull(),
    );

    await deposit('400');

    await waitFor(() => expect(screen.queryByText(SNACK_COPY.goal.deposited)).not.toBeNull());
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    const [row] = await database.getAllAsync<{ savedMinor: number }>(
      'SELECT savedMinor FROM goals',
      [],
    );
    expect(row?.savedMinor).toBe(40000);
    // Under target, so still the target badge.
    expect(screen.getByTestId('goal-badge-target', hidden)).toBeTruthy();
  });

  it('reschedules the goal reminders after a deposit, once for a goal with a deadline', async () => {
    await mountScreen(<GoalsScreen />, {
      clock: () => NOW,
      seed: async (database) => {
        await seedFallbackCategory(database);
        await createGoal(
          database,
          {
            name: 'Holiday',
            targetMinor: 100000,
            savedMinor: 0,
            currency: 'USD',
            deadline: '2026-11-20',
          },
          { id: GOAL_ID },
        );
      },
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`${GOAL_ROW_TEST_ID_PREFIX}-${GOAL_ID}`)).not.toBeNull(),
    );
    jest.clearAllMocks();

    await deposit('400');

    await waitFor(() => expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled());
    const ids = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(
      (call) => call[0].identifier,
    );
    expect(ids).toEqual([`goal-reminder:${GOAL_ID}:week`, `goal-reminder:${GOAL_ID}:day`]);
  });

  it('turns the badge to a check once the target is met', async () => {
    await mountScreen(<GoalsScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${GOAL_ROW_TEST_ID_PREFIX}-${GOAL_ID}`)).not.toBeNull(),
    );

    await deposit('1000');

    await waitFor(() => expect(screen.queryByTestId('goal-badge-check', hidden)).not.toBeNull());
  });

  it('keeps the empty state for an account with no goals', async () => {
    await mountScreen(<GoalsScreen />, {
      clock: () => NOW,
      seed: async (database) => {
        await seedFallbackCategory(database);
      },
    });

    await waitFor(() => expect(screen.queryByTestId('goals-empty')).not.toBeNull());
    expect(screen.getByText(COPY.goals.empty.headline)).toBeTruthy();
    expect(screen.getByTestId('empty-icon-target', hidden)).toBeTruthy();
  });
});
