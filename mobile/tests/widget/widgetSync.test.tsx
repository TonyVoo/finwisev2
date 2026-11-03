import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { cleanup } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { useWidgetSync } from '@/widget/useWidgetSync';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
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

const mockNative = {
  supported: true,
  pinResult: true,
  update: jest.fn(),
  clear: jest.fn(),
  pin: jest.fn(),
};
jest.mock('@/widget/native', () => ({
  homeWidgetSupported: () => mockNative.supported,
  updateHomeWidget: (...args: unknown[]) => mockNative.update(...args),
  clearHomeWidget: () => mockNative.clear(),
  requestHomeWidgetPin: () => {
    mockNative.pin();
    return mockNative.pinResult;
  },
}));

function Probe({ today }: { readonly today: string }) {
  useWidgetSync(today);
  return null;
}

async function seed(database: SqliteDatabase): Promise<void> {
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
    amountMinor: 1250,
    date: '2026-11-03',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: categoryId(1),
    amountMinor: 999,
    date: '2026-11-02',
  });
}

beforeEach(() => {
  resetRouter();
  mockNative.supported = true;
  mockNative.pinResult = true;
  mockNative.update.mockClear();
  mockNative.clear.mockClear();
  mockNative.pin.mockClear();
});

describe('the home-screen widget’s number', () => {
  it('is today’s spending, formatted in the account currency, with the app’s words', async () => {
    await mountScreen(<Probe today="2026-11-03" />, { seed });

    await waitFor(() =>
      expect(mockNative.update).toHaveBeenCalledWith(
        COPY.homeWidget.today,
        '$12.50',
        COPY.homeWidget.add,
      ),
    );
  });

  it('is forgotten when the signed-in app goes away', async () => {
    await mountScreen(<Probe today="2026-11-03" />, { seed });
    await waitFor(() => expect(mockNative.update).toHaveBeenCalled());

    await cleanup();

    expect(mockNative.clear).toHaveBeenCalled();
  });
});

describe('adding the widget from Settings', () => {
  it('asks the launcher to offer it', async () => {
    await mountScreen(<SettingsScreen />, { seed });
    await userEvent.press(await screen.findByTestId('settings-home-widget'));
    expect(mockNative.pin).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(COPY.homeWidget.unavailable)).toBeNull();
  });

  it('says how to add it by hand when the launcher cannot', async () => {
    mockNative.pinResult = false;
    await mountScreen(<SettingsScreen />, { seed });
    await userEvent.press(await screen.findByTestId('settings-home-widget'));
    expect(await screen.findByText(COPY.homeWidget.unavailable)).toBeTruthy();
  });

  it('has no row where there is no widget', async () => {
    mockNative.supported = false;
    await mountScreen(<SettingsScreen />, { seed });
    await screen.findByTestId('settings-export');
    expect(screen.queryByTestId('settings-home-widget')).toBeNull();
  });
});
