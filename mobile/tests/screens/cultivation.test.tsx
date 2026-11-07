import { screen, waitFor } from '@testing-library/react-native';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { PANEL_CORNERS_TEST_ID } from '@/components/PanelCorners';
import {
  CULTIVATION_GAUGE_TEST_ID,
  CULTIVATION_STREAK_TEST_ID,
  CULTIVATION_TEST_ID,
} from '@/cultivation/CultivationCard';
import {
  BREAKTHROUGH_CONTINUE_TEST_ID,
  BREAKTHROUGH_TEST_ID,
} from '@/cultivation/BreakthroughOverlay';
import { writeLastSyncedAt } from '@/sync/cursor';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import { mountScreen, pressOn } from '../support/mount';
import { resetRouter } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 14, 9, 0, 0);
const FOOD = categoryId(1);

/** `days` consecutive days with an entry, ending on the 14th (today). */
const seed =
  (options: { theme?: 'tutien'; days?: number; shownRealm?: number }) =>
  async (database: SqliteDatabase) => {
    await writeUser(database, {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: 'ada@example.com',
      currency: 'USD',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await writeLastSyncedAt(database, '2026-11-14T08:00:00.000Z');
    await seedFallbackCategory(database);
    await seedCategory(database, { id: FOOD, name: 'Food' });
    const days = options.days ?? 3;
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.UTC(2026, 10, 14 - i));
      await seedExpense(database, {
        id: expenseId(i + 1),
        categoryId: FOOD,
        amountMinor: 1000,
        date: d.toISOString().slice(0, 10),
      });
    }
    if (options.theme !== undefined)
      await writeMeta(database, META_KEYS.themePreference, options.theme);
    if (options.shownRealm !== undefined)
      await writeMeta(database, META_KEYS.cultivationRealm, String(options.shownRealm));
  };

beforeEach(() => resetRouter());

describe('the cultivation card on Home', () => {
  it('shows the realm, the gauge and the run of days in the cultivation appearance', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seed({ theme: 'tutien', days: 3 }),
    });

    await waitFor(() => expect(screen.queryByTestId(CULTIVATION_TEST_ID)).not.toBeNull());
    // 3 days logged: Qi Refining, early stage; a run of 3 days.
    expect(screen.getByText(/Qi Refining · Early/)).toBeTruthy();
    expect(screen.getByTestId(CULTIVATION_GAUGE_TEST_ID)).toBeTruthy();
    expect(String(screen.getByTestId(CULTIVATION_STREAK_TEST_ID).props.children)).toContain(
      '3 days',
    );
    expect(
      screen.getAllByTestId(PANEL_CORNERS_TEST_ID, { includeHiddenElements: true }).length,
    ).toBeGreaterThan(0);
  });

  it('is not there in the other appearances', async () => {
    await mountScreen(<ExpenseListScreen />, { clock: () => NOW, seed: seed({ days: 3 }) });
    await waitFor(() => expect(screen.queryByText(/Total this month/)).not.toBeNull());
    expect(screen.queryByTestId(CULTIVATION_TEST_ID)).toBeNull();
  });
});

describe('a breakthrough', () => {
  it('is shown once when a new realm is reached, then remembered', async () => {
    // 32 days logged = Foundation; the realm last shown was Qi Refining.
    const { database } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seed({ theme: 'tutien', days: 32, shownRealm: 0 }),
    });

    await waitFor(() => expect(screen.queryByTestId(BREAKTHROUGH_TEST_ID)).not.toBeNull());
    expect(screen.getAllByText(/Foundation/).length).toBeGreaterThan(0);
    expect(await readMeta(database, META_KEYS.cultivationRealm)).toBe('1');

    await pressOn(BREAKTHROUGH_CONTINUE_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId(BREAKTHROUGH_TEST_ID)).toBeNull());
  });

  it('is not shown the first time the card is seen: a person already standing in a realm is not congratulated', async () => {
    const { database } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seed({ theme: 'tutien', days: 32 }),
    });

    await waitFor(async () =>
      expect(await readMeta(database, META_KEYS.cultivationRealm)).toBe('1'),
    );
    expect(screen.queryByTestId(BREAKTHROUGH_TEST_ID)).toBeNull();
  });

  it('is not shown again for a realm already shown', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seed({ theme: 'tutien', days: 32, shownRealm: 1 }),
    });
    await waitFor(() => expect(screen.queryByTestId(CULTIVATION_TEST_ID)).not.toBeNull());
    expect(screen.queryByTestId(BREAKTHROUGH_TEST_ID)).toBeNull();
  });
});
