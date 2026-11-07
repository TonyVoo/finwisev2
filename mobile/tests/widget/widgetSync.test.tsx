import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { cleanup } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { createTrade } from '@/db/mutations';
import { readWidgetMode, writeWidgetMode } from '@/widget/widgetMode';
import { useWidgetSync } from '@/widget/useWidgetSync';
import SettingsScreen from '../../app/(app)/(tabs)/settings';
import { apiError, mountScreen, ok } from '../support/mount';
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
        'expensetracker://expense/new',
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

describe('the widget set to show the portfolio', () => {
  const quote = (close: number) =>
    ok(200, {
      data: {
        symbol: 'VNM',
        source: 'vnstock',
        demo: false,
        asOf: '2026-11-06',
        close,
        prevClose: close,
        changePct: 0,
        high52w: close,
        low52w: close,
        series: [{ date: '2026-11-06', close, volume: 1 }],
      },
    });

  const seedPortfolio = async (database: SqliteDatabase) => {
    await seed(database);
    await writeWidgetMode(database, 'portfolio');
    await createTrade(database, {
      symbol: 'VNM',
      side: 'buy',
      quantity: 100,
      price: 50000,
      fee: 0,
      date: '2026-11-01',
    });
  };

  it('shows what is held at the last close, how it is doing, and opens the portfolio', async () => {
    await mountScreen(<Probe today="2026-11-03" />, {
      seed: seedPortfolio,
      transport: async () => quote(55000),
    });

    await waitFor(() =>
      expect(mockNative.update).toHaveBeenCalledWith(
        COPY.portfolio.title,
        expect.stringMatching(/5[.,]500[.,]000/),
        '+10%',
        'expensetracker://portfolio',
      ),
    );
    // And not today's spending, which is another mode's number.
    expect(mockNative.update).not.toHaveBeenCalledWith(
      COPY.homeWidget.today,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('shows the cost and a plain Open button, rather than a made-up change, when no price can be had', async () => {
    await mountScreen(<Probe today="2026-11-03" />, {
      seed: seedPortfolio,
      transport: async () => apiError(503, 'market_unavailable'),
    });

    await waitFor(() =>
      expect(mockNative.update).toHaveBeenCalledWith(
        COPY.portfolio.title,
        expect.stringMatching(/5[.,]000[.,]000/),
        COPY.homeWidget.open,
        'expensetracker://portfolio',
      ),
    );
  });

  it('writes nothing while there is no portfolio to show', async () => {
    await mountScreen(<Probe today="2026-11-03" />, {
      seed: async (database) => {
        await seed(database);
        await writeWidgetMode(database, 'portfolio');
      },
      transport: async () => quote(55000),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockNative.update).not.toHaveBeenCalled();
  });
});

describe('choosing what the widget shows', () => {
  it('flips between spending and the portfolio from Settings and remembers it', async () => {
    const { database } = await mountScreen(<SettingsScreen />, { seed });
    const row = await screen.findByTestId('settings-widget-mode');
    expect(row).toHaveTextContent(new RegExp(COPY.homeWidget.showSpending));

    await userEvent.press(row);

    await waitFor(() =>
      expect(screen.getByTestId('settings-widget-mode')).toHaveTextContent(
        new RegExp(COPY.homeWidget.showPortfolio),
      ),
    );
    expect(await readWidgetMode(database)).toBe('portfolio');
  });

  it('has no such row where there is no widget', async () => {
    mockNative.supported = false;
    await mountScreen(<SettingsScreen />, { seed });
    await screen.findByTestId('settings-export');
    expect(screen.queryByTestId('settings-widget-mode')).toBeNull();
  });
});
