import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/** Home's budget banner, over a real container. 14 October 2026 is "this month". */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const FOOD = categoryId(1);

async function seed(
  database: SqliteDatabase,
  { spent, budget, date = '2026-10-10' }: { spent: number; budget: number | null; date?: string },
): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', monthlyBudgetMinor: budget });
  await seedExpense(database, { id: expenseId(1), categoryId: FOOD, amountMinor: spent, date });
}

beforeEach(() => {
  resetRouter();
});

describe('the budget banner on Home', () => {
  it('warns when a category is over its budget this month, and says which', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, { spent: 15000, budget: 10000 }),
    });

    await waitFor(() => expect(screen.queryByTestId('budget-alert')).not.toBeNull());
    expect(screen.getByText('Over budget')).toBeTruthy();
    expect(screen.getByText('Food: spending is past the monthly budget.')).toBeTruthy();
  });

  it('uses the softer wording when the category is close but not over', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, { spent: 9000, budget: 10000 }),
    });

    await waitFor(() => expect(screen.queryByText('Close to budget')).not.toBeNull());
  });

  it('stays out of the way when the budget is fine, or there is none', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, { spent: 1000, budget: 10000 }),
    });
    await waitFor(() => expect(screen.queryByText('Food')).not.toBeNull());

    expect(screen.queryByTestId('budget-alert')).toBeNull();
  });

  it('does not nag about a category with no budget', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, { spent: 999999, budget: null }),
    });
    await waitFor(() => expect(screen.queryByText('Food')).not.toBeNull());

    expect(screen.queryByTestId('budget-alert')).toBeNull();
  });

  it('opens the Summary from See summary', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, { spent: 15000, budget: 10000 }),
    });
    await waitFor(() => expect(screen.queryByTestId('budget-alert-open')).not.toBeNull());

    await userEvent.press(screen.getByTestId('budget-alert-open'));

    expect(routerRecord.push).toContain('/(app)/(tabs)/summary');
  });

  it('hides on Dismiss', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: (db) => seed(db, { spent: 15000, budget: 10000 }),
    });
    await waitFor(() => expect(screen.queryByTestId('budget-alert-dismiss')).not.toBeNull());

    await userEvent.press(screen.getByTestId('budget-alert-dismiss'));

    expect(screen.queryByTestId('budget-alert')).toBeNull();
  });
});
