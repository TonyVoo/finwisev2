import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import YearReportScreen, {
  YEAR_MONTH_TEST_ID_PREFIX,
  YEAR_NEXT_TEST_ID,
  YEAR_PREVIOUS_TEST_ID,
  YEAR_SHARE_TEST_ID,
} from '../../app/(app)/year';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import { mountScreen } from '../support/mount';
import { resetRouter, routerRecord } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';
import { writeLastSyncedAt } from '@/sync/cursor';

jest.mock('expo-router');

const mockPrint = jest.fn(async (_options: { html: string }) => ({
  uri: 'file:///cache/year.pdf',
}));
const mockShare = jest.fn(async (_uri: string, _options: object) => undefined);
const mockAvailable = jest.fn(async () => true);
jest.mock('expo-print', () => ({ printToFileAsync: (o: { html: string }) => mockPrint(o) }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (uri: string, o: object) => mockShare(uri, o),
}));

const NOW = new Date(2026, 10, 3, 9, 0, 0);
const FOOD = categoryId(1);
const RENT = categoryId(2);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2025-01-01T00:00:00.000Z',
  });
  await writeLastSyncedAt(database, '2026-11-02T08:00:00.000Z');
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food', color: '#2F8044' });
  await seedCategory(database, { id: RENT, name: 'Rent', color: '#B3261E' });
  const add = (
    n: number,
    categoryId: string,
    amountMinor: number,
    date: string,
    extra: object = {},
  ) => seedExpense(database, { id: expenseId(n), categoryId, amountMinor, date, ...extra });
  await add(1, RENT, 100000, '2026-01-05');
  await add(2, FOOD, 20000, '2026-03-05');
  await add(3, FOOD, 10000, '2025-03-05');
  await add(4, RENT, 100000, '2025-06-05');
  await add(5, FOOD, 500000, '2026-02-01', { kind: 'income' });
}

beforeEach(() => {
  resetRouter();
  mockPrint.mockClear();
  mockShare.mockClear();
  mockAvailable.mockImplementation(async () => true);
});

describe('the year in review', () => {
  it('shows the year’s figures and a row for every month', async () => {
    await mountScreen(<YearReportScreen />, { clock: () => NOW, seed });

    await waitFor(() => expect(screen.queryByText(COPY.yearReport.spent)).not.toBeNull());
    expect(screen.getByText('$1,200.00')).toBeTruthy(); // spent
    expect(screen.getByText('$5,000.00')).toBeTruthy(); // income
    for (let m = 1; m <= 12; m++) {
      const key = `2026-${String(m).padStart(2, '0')}`;
      expect(screen.getByTestId(`${YEAR_MONTH_TEST_ID_PREFIX}-${key}`)).toBeTruthy();
    }
    expect(screen.getByText(/more than 2025/)).toBeTruthy(); // Rent is flat, Food rose by $100
  });

  it('steps back to the year before, and stops at the current one', async () => {
    await mountScreen(<YearReportScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByText(COPY.yearReport.spent)).not.toBeNull());

    await userEvent.press(screen.getByTestId(YEAR_PREVIOUS_TEST_ID));
    await waitFor(() => expect(screen.queryByText('2025')).not.toBeNull());
    expect(await screen.findByText('$1,100.00')).toBeTruthy();

    await userEvent.press(screen.getByTestId(YEAR_NEXT_TEST_ID));
    await userEvent.press(screen.getByTestId(YEAR_NEXT_TEST_ID));
    await waitFor(() => expect(screen.queryByText('2026')).not.toBeNull());
  });

  it('says so for a year with nothing in it', async () => {
    await mountScreen(<YearReportScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByText(COPY.yearReport.spent)).not.toBeNull());
    await userEvent.press(screen.getByTestId(YEAR_PREVIOUS_TEST_ID));
    await userEvent.press(screen.getByTestId(YEAR_PREVIOUS_TEST_ID));

    expect(await screen.findByText('Nothing recorded in 2024.')).toBeTruthy();
  });

  it('makes a PDF on the phone and hands it to the share sheet', async () => {
    await mountScreen(<YearReportScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(YEAR_SHARE_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(YEAR_SHARE_TEST_ID));

    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    expect(mockPrint.mock.calls[0]?.[0].html).toContain('2026');
    expect(mockShare.mock.calls[0]?.[0]).toBe('file:///cache/year.pdf');
  });

  it('says so, and makes nothing, when the device cannot share', async () => {
    mockAvailable.mockImplementation(async () => false);
    await mountScreen(<YearReportScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(YEAR_SHARE_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(YEAR_SHARE_TEST_ID));

    expect(await screen.findByText(COPY.yearReport.shareUnavailable)).toBeTruthy();
    expect(mockPrint).not.toHaveBeenCalled();
  });
});

describe('opening it from the Summary', () => {
  it('has a row that opens the year', async () => {
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });

    await userEvent.press(await screen.findByTestId('summary-year'));

    expect(routerRecord.push).toContainEqual('/(app)/year');
  });
});
