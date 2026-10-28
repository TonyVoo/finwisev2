import { screen, userEvent, waitFor } from '@testing-library/react-native';
import type { ReceiptScan } from '@expense-tracker/shared';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import {
  CATEGORY_ROW_TEST_ID,
  DATE_ROW_TEST_ID,
  NOTE_ROW_TEST_ID,
  RECEIPT_ROW_TEST_ID,
  SAVE_TEST_ID,
} from '@/expenses/ExpenseFormScreen';
import { dateRowLabel } from '@/lib/calendar';
import { setReceiptPickerForTests } from '@/receipts/receiptPicker';
import { RECEIPT_SCAN_TEST_ID, RECEIPT_TAKE_TEST_ID } from '@/receipts/ReceiptSheet';
import {
  RECEIPT_SUGGESTION_DISMISS_TEST_ID,
  RECEIPT_SUGGESTION_TEST_ID,
  RECEIPT_SUGGESTION_USE_TEST_ID,
} from '@/receipts/ReceiptSuggestionCard';
import { resetScanAvailabilityForTests } from '@/receipts/scanAvailability';
import NewExpenseScreen from '../../app/(app)/expense/new';
import { resetRouter } from '../support/router';
import { apiError, mountScreen, ok, type MountedScreen } from '../support/mount';
import { categoryId, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

/**
 * Reading a receipt on the expense form. The reading is a suggestion: nothing reaches a field
 * until the person taps Use, nothing is saved until they press Save, and every way the reading
 * can fail leaves the form exactly as it was. The network is a fake transport answering
 * `POST /v1/receipts/scan`; anything else it is asked for fails the test.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const IMG = '/9j/AAAA';
const FOUND: ReceiptScan = {
  amountMinor: 1250,
  currency: 'USD',
  date: '2026-10-13',
  merchant: 'Milk Mart',
  category: 'groceries',
};

async function seedBasics(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
}

function scanReturns(response: TransportResponse) {
  return async (request: TransportRequest): Promise<TransportResponse> => {
    if (request.method === 'post' && request.path === '/v1/receipts/scan') return response;
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  };
}

async function mountWithPhoto(response: TransportResponse): Promise<MountedScreen> {
  setReceiptPickerForTests({
    takePhoto: async () => ({ status: 'picked', dataBase64: IMG }),
    chooseFromLibrary: async () => ({ status: 'picked', dataBase64: IMG }),
  });
  const mounted = await mountScreen(<NewExpenseScreen />, {
    clock: () => NOW,
    seed: seedBasics,
    transport: scanReturns(response),
  });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  // Attach a photo, then reopen the sheet: the sheet closes itself once a photo is chosen.
  await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
  await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));
  await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
  return mounted;
}

// The sheet stays open after a failed reading, which hides the form behind it from queries.
const label = (testID: string) =>
  screen.getByTestId(testID, { includeHiddenElements: true }).props.accessibilityLabel as string;

beforeEach(() => {
  resetRouter();
  resetScanAvailabilityForTests();
});
afterEach(() => setReceiptPickerForTests(null));

describe('the Read receipt button', () => {
  it('is not offered until there is a photo', async () => {
    await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: seedBasics,
      transport: scanReturns(ok(200, { data: FOUND })),
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));

    expect(screen.queryByTestId(RECEIPT_SCAN_TEST_ID)).toBeNull();
  });

  it('says what it does with the photo, and sends nothing until it is pressed', async () => {
    const { requests } = await mountWithPhoto(ok(200, { data: FOUND }));

    expect(screen.getByTestId(RECEIPT_SCAN_TEST_ID)).toBeTruthy();
    expect(screen.getByText(COPY.form.receipt.scan.hint)).toBeTruthy();
    expect(requests).toEqual([]);
  });
});

describe('a reading that found something', () => {
  it('sends the photo and shows a suggestion card, changing no field', async () => {
    const { requests } = await mountWithPhoto(ok(200, { data: FOUND }));

    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));

    await waitFor(() => expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'post',
      path: '/v1/receipts/scan',
      body: { contentType: 'image/jpeg', dataBase64: IMG },
    });
    expect(screen.getByText(COPY.form.receipt.scan.suggestionTitle)).toBeTruthy();
    expect(screen.getByText(/\$12\.50 · .* · Milk Mart/)).toBeTruthy();
    // Nothing has been put in a field yet.
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('12.50');
    expect(label(NOTE_ROW_TEST_ID)).not.toContain('Milk Mart');
  });

  it('fills the fields on Use, and still saves nothing until Save', async () => {
    const { database } = await mountWithPhoto(ok(200, { data: FOUND }));
    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));
    await waitFor(() => expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(RECEIPT_SUGGESTION_USE_TEST_ID));

    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('12.50');
    expect(label(DATE_ROW_TEST_ID)).toContain(dateRowLabel('2026-10-13', '2026-10-14'));
    expect(label(NOTE_ROW_TEST_ID)).toContain('Milk Mart');
    expect(label(CATEGORY_ROW_TEST_ID)).toContain('Groceries');
    expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).toBeNull();
    expect(await outboxEntries(database)).toEqual([]);
  });

  it('saves what was used, as an ordinary expense', async () => {
    const { database } = await mountWithPhoto(ok(200, { data: FOUND }));
    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));
    await waitFor(() => expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).not.toBeNull());
    await userEvent.press(screen.getByTestId(RECEIPT_SUGGESTION_USE_TEST_ID));

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect((await outboxEntries(database)).some((entry) => entry.entity === 'expense')).toBe(
        true,
      ),
    );
    const entry = (await outboxEntries(database)).find((row) => row.entity === 'expense');
    expect(JSON.parse(entry?.fields ?? '{}')).toMatchObject({
      amountMinor: 1250,
      date: '2026-10-13',
      note: 'Milk Mart',
      categoryId: GROCERIES,
    });
  });

  it('leaves every field alone on Dismiss', async () => {
    await mountWithPhoto(ok(200, { data: FOUND }));
    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));
    await waitFor(() => expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(RECEIPT_SUGGESTION_DISMISS_TEST_ID));

    expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).toBeNull();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('12.50');
    expect(label(NOTE_ROW_TEST_ID)).not.toContain('Milk Mart');
  });
});

describe('a reading that did not work out', () => {
  const NOTHING: ReceiptScan = {
    amountMinor: null,
    currency: 'USD',
    date: null,
    merchant: null,
    category: null,
  };

  it('says so when nothing could be read, and offers no card', async () => {
    await mountWithPhoto(ok(200, { data: NOTHING }));

    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));

    await waitFor(() =>
      expect(screen.queryByText(COPY.form.receipt.scan.nothingFound)).not.toBeNull(),
    );
    expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).toBeNull();
  });

  it('says so when the provider failed, and leaves the form as it was', async () => {
    await mountWithPhoto(apiError(502, 'ocr_failed'));

    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));

    await waitFor(() => expect(screen.queryByText(COPY.form.receipt.scan.failed)).not.toBeNull());
    expect(screen.queryByTestId(RECEIPT_SUGGESTION_TEST_ID)).toBeNull();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('12.50');
  });

  it('says so, and stops offering the button, when this server cannot read receipts', async () => {
    await mountWithPhoto(apiError(503, 'ocr_unavailable'));

    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));

    await waitFor(() =>
      expect(screen.queryByText(COPY.form.receipt.scan.unavailable)).not.toBeNull(),
    );
    expect(screen.queryByTestId(RECEIPT_SCAN_TEST_ID)).toBeNull();
  });

  it('stays open and can be tried again after a failure', async () => {
    await mountWithPhoto(apiError(502, 'ocr_failed'));
    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));
    await waitFor(() => expect(screen.queryByText(COPY.form.receipt.scan.failed)).not.toBeNull());

    expect(screen.getByTestId(RECEIPT_SCAN_TEST_ID)).toBeTruthy();
  });
});
