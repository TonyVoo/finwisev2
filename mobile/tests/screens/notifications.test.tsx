import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { META_KEYS, readMeta } from '@/db/meta';
import { writeUser } from '@/db/user';
import { addAlert, markFired, readAlerts } from '@/invest/alerts';
import { savePlan } from '@/invest/dca';
import { BELL_BADGE_TEST_ID, BELL_TEST_ID } from '@/notifications/NotificationBell';
import { countUnread } from '@/notifications/inbox';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import NotificationsScreen, {
  NOTIFICATIONS_ALERT_PREFIX,
  NOTIFICATIONS_ALLOW_TEST_ID,
  NOTIFICATIONS_EMPTY_TEST_ID,
  NOTIFICATIONS_OFF_TEST_ID,
} from '../../app/(app)/notifications';
import { mountScreen, pressOn, type MountedScreen } from '../support/mount';
import { resetRouter, routerRecord } from '../support/router';
import { seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 9, 9, 0, 0);
const perms = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
};

async function seedUser(database: MountedScreen['database']): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'VND',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
}

async function fireAlert(database: MountedScreen['database'], at: Date): Promise<string> {
  await addAlert(database, 'VNM', 'above', 60000);
  const [alert] = await readAlerts(database);
  await markFired(database, [{ id: (alert as { id: string }).id, close: 61000 }], at);
  return (alert as { id: string }).id;
}

beforeEach(() => {
  resetRouter();
  jest.clearAllMocks();
  perms.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
});

describe('the notifications screen', () => {
  it('lists the alerts that fired and the plans coming up', async () => {
    let id = '';
    await mountScreen(<NotificationsScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seedUser(db);
        id = await fireAlert(db, new Date(2026, 10, 8, 10, 0, 0));
        await savePlan(db, { symbol: 'FPT', amount: 2_000_000, day: 15 }, null);
      },
    });

    await waitFor(() =>
      expect(screen.queryByTestId(`${NOTIFICATIONS_ALERT_PREFIX}-${id}`)).not.toBeNull(),
    );
    expect(screen.getByText(/VNM .*61[.,]000/)).toBeTruthy();
    expect(screen.getByText(COPY.notifications.priceAlerts)).toBeTruthy();
    expect(screen.getByText(COPY.notifications.comingUp)).toBeTruthy();
    expect(screen.getByText(/FPT: .*2[.,]000[.,]000/)).toBeTruthy();
    expect(screen.queryByTestId(NOTIFICATIONS_EMPTY_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(NOTIFICATIONS_OFF_TEST_ID)).toBeNull();
  });

  it('says so when there is nothing yet', async () => {
    await mountScreen(<NotificationsScreen />, { clock: () => NOW, seed: seedUser });
    await waitFor(() => expect(screen.queryByTestId(NOTIFICATIONS_EMPTY_TEST_ID)).not.toBeNull());
  });

  it('marks what it showed as seen', async () => {
    const { database } = await mountScreen(<NotificationsScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seedUser(db);
        await fireAlert(db, new Date(2026, 10, 8, 10, 0, 0));
      },
    });
    await waitFor(async () =>
      expect(await readMeta(database, META_KEYS.notificationsSeenAt)).not.toBeNull(),
    );
  });

  it('asks to allow notifications when they are off, which is why an alert fires and nothing shows', async () => {
    perms.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await mountScreen(<NotificationsScreen />, { clock: () => NOW, seed: seedUser });
    await waitFor(() => expect(screen.queryByTestId(NOTIFICATIONS_OFF_TEST_ID)).not.toBeNull());

    await pressOn(NOTIFICATIONS_ALLOW_TEST_ID);

    expect(perms.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('opens the system settings once the system will not ask again', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    perms.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await mountScreen(<NotificationsScreen />, { clock: () => NOW, seed: seedUser });
    await waitFor(() => expect(screen.queryByTestId(NOTIFICATIONS_ALLOW_TEST_ID)).not.toBeNull());

    await pressOn(NOTIFICATIONS_ALLOW_TEST_ID);

    expect(openSettings).toHaveBeenCalled();
    expect(perms.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('the bell on Home', () => {
  it('counts what fired since the screen was last opened, and opens the screen', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seedUser(db);
        await fireAlert(db, new Date(2026, 10, 8, 10, 0, 0));
      },
    });

    await waitFor(() => expect(screen.queryByTestId(BELL_BADGE_TEST_ID)).not.toBeNull());
    expect(screen.getByTestId(BELL_TEST_ID).props.accessibilityLabel).toBe(
      COPY.notifications.openNew.replace('{count}', '1'),
    );

    await pressOn(BELL_TEST_ID);
    expect(routerRecord.push).toEqual(['/(app)/notifications']);
  });

  it('shows no badge when nothing is new', async () => {
    await mountScreen(<ExpenseListScreen />, { clock: () => NOW, seed: seedUser });
    await waitFor(() => expect(screen.queryByTestId(BELL_TEST_ID)).not.toBeNull());
    expect(screen.queryByTestId(BELL_BADGE_TEST_ID)).toBeNull();
  });
});

describe('countUnread', () => {
  const fired = (at: string) => ({
    id: at,
    symbol: 'VNM',
    direction: 'above' as const,
    price: 1,
    firedAt: at,
    firedPrice: 1,
  });
  it('counts only what fired after the last look, and everything on the first', () => {
    const alerts = [
      fired('2026-11-08T10:00:00.000Z'),
      fired('2026-11-09T10:00:00.000Z'),
      { ...fired('x'), firedAt: null },
    ];
    expect(countUnread(alerts, null)).toBe(2);
    expect(countUnread(alerts, '2026-11-09T00:00:00.000Z')).toBe(1);
    expect(countUnread(alerts, '2026-11-10T00:00:00.000Z')).toBe(0);
  });
});
