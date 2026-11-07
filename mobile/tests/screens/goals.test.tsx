import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { META_KEYS, writeMeta } from '@/db/meta';
import { createGoal, createTrade } from '@/db/mutations';
import { writeLinkedGoal } from '@/goals/portfolioLink';
import { ok } from '../support/mount';
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

describe('a goal that counts the stock portfolio', () => {
  const seedLinked = async (database: SqliteDatabase) => {
    await seedFallbackCategory(database);
    await createGoal(
      database,
      {
        name: 'Laptop',
        targetMinor: 30_000_000,
        savedMinor: 5_000_000,
        currency: 'VND',
        deadline: null,
      },
      { id: GOAL_ID },
    );
    await createTrade(database, {
      symbol: 'VNM',
      side: 'buy',
      quantity: 100,
      price: 50000,
      fee: 0,
      date: '2026-10-01',
    });
    await writeLinkedGoal(database, GOAL_ID);
  };

  it('adds what the stocks are worth now to its progress, and says so', async () => {
    await mountScreen(<GoalsScreen />, {
      clock: () => NOW,
      seed: seedLinked,
      transport: async () =>
        ok(200, {
          data: {
            symbol: 'VNM',
            source: 'vnstock',
            demo: false,
            asOf: '2026-10-26',
            close: 60000,
            prevClose: 60000,
            changePct: 0,
            high52w: 60000,
            low52w: 60000,
            series: [{ date: '2026-10-26', close: 60000, volume: 1 }],
          },
        }),
    });

    // 5.000.000 saved + 100 shares at 60.000 = 11.000.000 of 30.000.000.
    await waitFor(() => expect(screen.queryByTestId(`goal-included-${GOAL_ID}`)).not.toBeNull());
    expect(String(screen.getByTestId(`goal-included-${GOAL_ID}`).props.children)).toMatch(
      /6[.,]000[.,]000/,
    );
    expect(screen.getByText(/36%/)).toBeTruthy();
  });

  it('shows the goal as saved when no price can be had: the stocks count at cost', async () => {
    await mountScreen(<GoalsScreen />, {
      clock: () => NOW,
      seed: seedLinked,
      transport: async () => {
        throw new Error('offline');
      },
    });

    await waitFor(() => expect(screen.queryByTestId(`goal-included-${GOAL_ID}`)).not.toBeNull());
    expect(String(screen.getByTestId(`goal-included-${GOAL_ID}`).props.children)).toMatch(
      /5[.,]000[.,]000/,
    );
  });
});

describe('a goal in the cultivation appearance', () => {
  it('shows the realm its progress has reached, on a line of its own', async () => {
    await mountScreen(<GoalsScreen />, {
      clock: () => NOW,
      seed: async (database) => {
        await seedFallbackCategory(database);
        await createGoal(
          database,
          {
            name: 'Holiday',
            targetMinor: 100000,
            savedMinor: 40000,
            currency: 'USD',
            deadline: null,
          },
          { id: GOAL_ID },
        );
        await writeMeta(database, META_KEYS.themePreference, 'tutien');
      },
    });

    await waitFor(() => expect(screen.queryByTestId(`goal-realm-${GOAL_ID}`)).not.toBeNull());
    // 40% is the third realm.
    expect(screen.getByTestId(`goal-realm-${GOAL_ID}`).props.children).toBe('Golden Core');
  });

  it('shows no realm in the other appearances', async () => {
    await mountScreen(<GoalsScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${GOAL_ROW_TEST_ID_PREFIX}-${GOAL_ID}`)).not.toBeNull(),
    );
    expect(screen.queryByTestId(`goal-realm-${GOAL_ID}`)).toBeNull();
  });
});
