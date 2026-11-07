import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { writeLastSyncedAt } from '@/sync/cursor';
import SummaryScreen, { SUMMARY_SHARE_TEST_ID } from '../../app/(app)/(tabs)/summary';
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

const mockPrint = jest.fn(async (_options: { html: string }) => ({
  uri: 'file:///cache/month.pdf',
}));
const mockShare = jest.fn(async (_uri: string, _options: object) => undefined);
const mockAvailable = jest.fn(async () => true);
jest.mock('expo-print', () => ({ printToFileAsync: (o: { html: string }) => mockPrint(o) }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockAvailable(),
  shareAsync: (uri: string, o: object) => mockShare(uri, o),
}));

const NOW = new Date(2026, 10, 14, 9, 0, 0);
const FOOD = categoryId(1);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await writeLastSyncedAt(database, '2026-11-14T08:00:00.000Z');
  await seedFallbackCategory(database);
  await seedCategory(database, { id: FOOD, name: 'Food <b>Bar</b>' });
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: FOOD,
    amountMinor: 12_345,
    date: '2026-11-03',
  });
}

beforeEach(() => {
  resetRouter();
  mockPrint.mockClear();
  mockShare.mockClear();
  mockAvailable.mockImplementation(async () => true);
});

describe('the month as a PDF', () => {
  it('makes it on the phone from what the screen shows, and hands it to the share sheet', async () => {
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(SUMMARY_SHARE_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(SUMMARY_SHARE_TEST_ID));

    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const html = mockPrint.mock.calls[0]?.[0].html ?? '';
    expect(html).toContain('November 2026');
    expect(html).toContain('$123.45');
    expect(html).toContain('Food &lt;b&gt;Bar&lt;/b&gt;');
    expect(html).not.toContain('<b>Bar</b>');
    expect(mockShare.mock.calls[0]?.[0]).toBe('file:///cache/month.pdf');
  });

  it('says so, and makes nothing, when the device cannot share', async () => {
    mockAvailable.mockImplementation(async () => false);
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(SUMMARY_SHARE_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(SUMMARY_SHARE_TEST_ID));

    expect(await screen.findByText(COPY.summary.report.unavailable)).toBeTruthy();
    expect(mockPrint).not.toHaveBeenCalled();
  });

  it('says it could not, when the print service fails', async () => {
    mockPrint.mockRejectedValueOnce(new Error('print down'));
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed });
    await waitFor(() => expect(screen.queryByTestId(SUMMARY_SHARE_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(SUMMARY_SHARE_TEST_ID));

    expect(await screen.findByText(COPY.summary.report.failed)).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
  });
});
