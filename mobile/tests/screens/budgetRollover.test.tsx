import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { writeLastSyncedAt } from '@/sync/cursor';
import { LEGEND_TEST_ID } from '@/summary/SpendLegend';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import { mountScreen } from '../support/mount';
import { resetRouter } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const FOOD = categoryId(1);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await writeLastSyncedAt(database, '2026-10-16T08:00:00.000Z');
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', monthlyBudgetMinor: 20000 });
  // September: $50 of a $200 budget spent. October: $60 spent.
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: FOOD,
    amountMinor: 5000,
    date: '2026-09-10',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: FOOD,
    amountMinor: 6000,
    date: '2026-10-10',
  });
}

beforeEach(() => resetRouter());

describe('budget rollover on the Summary', () => {
  it('is off by default: October is $60 against its own $200', async () => {
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(LEGEND_TEST_ID)).not.toBeNull());

    expect(await screen.findByText(/\$140\.00 left of \$200\.00/)).toBeTruthy();
    expect(screen.queryByText(/carried over/)).toBeNull();
  });

  it('adds last month’s unspent $150 when it is on, and says so', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: async (database) => {
        await seed(database);
        await writeMeta(database, META_KEYS.budgetRollover, '1');
      },
    });

    // $200 + $150 carried = $350 available, $60 spent.
    expect(
      await screen.findByText(/\$290\.00 left of \$350\.00 \(\$150\.00 carried over\)/),
    ).toBeTruthy();
  });
});

describe('the Settings switch', () => {
  it('turns it on and remembers it on the device', async () => {
    const { database } = await mountScreen(<SettingsScreen />, { clock: () => NOW, seed });

    await userEvent.press(await screen.findByTestId('settings-rollover'));

    await waitFor(async () => expect(await readMeta(database, META_KEYS.budgetRollover)).toBe('1'));
    expect(screen.getByText(COPY.rollover.title)).toBeTruthy();
  });
});
