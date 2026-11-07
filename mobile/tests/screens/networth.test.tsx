import { screen, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { createGoal, createTrade } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { readSnapshots } from '@/invest/netWorth';
import NetWorthScreen, {
  NETWORTH_CHART_TEST_ID,
  NETWORTH_NOTE_TEST_ID,
  NETWORTH_SAVINGS_TEST_ID,
  NETWORTH_STOCKS_TEST_ID,
  NETWORTH_TOTAL_TEST_ID,
  NETWORTH_VND_ONLY_TEST_ID,
} from '../../app/(app)/networth';
import { mountScreen, ok } from '../support/mount';
import { resetRouter } from '../support/router';
import { seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const NOW = new Date(2026, 10, 6, 9, 0, 0);

const series = [
  ['2026-10-01', 50000],
  ['2026-10-02', 51000],
  ['2026-10-05', 52000],
  ['2026-10-06', 53000],
  ['2026-11-04', 56000],
  ['2026-11-05', 56500],
  ['2026-11-06', 56800],
].map(([date, close]) => ({ date: date as string, close: close as number, volume: 1 }));

async function transport(request: TransportRequest): Promise<TransportResponse> {
  if (/^\/v1\/market\/quotes\/\w+$/.test(request.path)) {
    return ok(200, {
      data: {
        symbol: 'VNM',
        source: 'vnstock',
        demo: false,
        asOf: '2026-11-06',
        close: 56800,
        prevClose: 56500,
        changePct: 0,
        high52w: 60000,
        low52w: 50000,
        series,
      },
    });
  }
  throw new Error(`unexpected request ${request.method} ${request.path}`);
}

const seed =
  (currency: string, withTrade = true) =>
  async (database: SqliteDatabase) => {
    await writeUser(database, {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: 'ada@example.com',
      currency,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    await seedFallbackCategory(database);
    await createGoal(database, {
      name: 'Laptop',
      targetMinor: 30_000_000,
      savedMinor: 5_000_000,
      currency: 'VND',
      deadline: null,
    });
    if (withTrade) {
      await createTrade(database, {
        symbol: 'VNM',
        side: 'buy',
        quantity: 100,
        price: 50000,
        fee: 0,
        date: '2026-10-01',
      });
    }
  };

beforeEach(() => resetRouter());

describe('the net worth screen', () => {
  it('adds the savings to what the stocks are worth now, and shows each part', async () => {
    const { database } = await mountScreen(<NetWorthScreen />, {
      clock: () => NOW,
      transport,
      seed: seed('VND'),
    });

    // 5.000.000 saved + 100 shares at 56.800.
    await waitFor(() =>
      expect(String(screen.getByTestId(NETWORTH_TOTAL_TEST_ID).props.children)).toMatch(
        /10[.,]680[.,]000/,
      ),
    );
    expect(screen.getByTestId(NETWORTH_SAVINGS_TEST_ID)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId(NETWORTH_STOCKS_TEST_ID)).not.toBeNull());
    expect(await readSnapshots(database)).toEqual([
      { date: '2026-11-06', savingsMinor: 5_000_000 },
    ]);
  });

  it('with only the savings and no stocks, is just the savings', async () => {
    await mountScreen(<NetWorthScreen />, {
      clock: () => NOW,
      transport,
      seed: seed('VND', false),
    });
    await waitFor(() =>
      expect(String(screen.getByTestId(NETWORTH_TOTAL_TEST_ID).props.children)).toMatch(
        /5[.,]000[.,]000/,
      ),
    );
    expect(screen.queryByTestId(NETWORTH_STOCKS_TEST_ID)).toBeNull();
  });

  it('says where the savings begin, and draws a chart once there are days to draw', async () => {
    await mountScreen(<NetWorthScreen />, { clock: () => NOW, transport, seed: seed('VND') });
    await waitFor(() => expect(screen.queryByTestId(NETWORTH_NOTE_TEST_ID)).not.toBeNull());
    expect(screen.getByTestId(NETWORTH_NOTE_TEST_ID).props.children).toContain('2026-11-06');
    // The savings are known from today only, so the stocks' earlier days are left out: one day is no chart yet.
    expect(screen.queryByTestId(NETWORTH_CHART_TEST_ID)).toBeNull();
    expect(screen.getByText(COPY.netWorth.chartEmpty)).toBeTruthy();
  });

  it('is for accounts in dong only', async () => {
    await mountScreen(<NetWorthScreen />, { clock: () => NOW, transport, seed: seed('USD') });
    await waitFor(() => expect(screen.queryByTestId(NETWORTH_VND_ONLY_TEST_ID)).not.toBeNull());
    expect(screen.queryByTestId(NETWORTH_TOTAL_TEST_ID)).toBeNull();
  });
});
