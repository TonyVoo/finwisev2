import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { CONFIRM_COPY, COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import { CLOSE_TEST_ID, RECEIPT_ROW_TEST_ID, SAVE_TEST_ID } from '@/expenses/ExpenseFormScreen';
import { setReceiptPickerForTests, type PickOutcome } from '@/receipts/receiptPicker';
import {
  RECEIPT_CHOOSE_TEST_ID,
  RECEIPT_IMAGE_TEST_ID,
  RECEIPT_REMOVE_TEST_ID,
  RECEIPT_TAKE_TEST_ID,
} from '@/receipts/ReceiptSheet';
import { readReceipt, storeDownloaded } from '@/receipts/receiptStore';
import NewExpenseScreen from '../../app/(app)/expense/new';
import EditExpenseScreen from '../../app/(app)/expense/[id]';
import { resetRouter, routerRecord, setSearchParams } from '../support/router';
import { mountScreen, type MountedScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * Receipt photos on the expense form.
 *
 * The photo is a draft like every other field: nothing is stored until Save, Save is
 * available for a photo-only edit, and closing with an unsaved photo asks first. The
 * picker is replaced (`setReceiptPickerForTests`) because the camera is native; what is
 * verified is everything the app does with what it returns. The transport fails the test
 * if called, so every case here also works in airplane mode.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);
const IMG = '/9j/AAAA';

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

async function seedEditable(database: SqliteDatabase): Promise<void> {
  await seedBasics(database);
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: GROCERIES,
    amountMinor: 1250,
    date: '2026-10-13',
    note: 'Milk',
  });
}

function pickerReturning(outcome: PickOutcome) {
  const calls: string[] = [];
  setReceiptPickerForTests({
    takePhoto: async () => {
      calls.push('camera');
      return outcome;
    },
    chooseFromLibrary: async () => {
      calls.push('library');
      return outcome;
    },
  });
  return calls;
}

async function ready(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
}

async function mountAdd(): Promise<MountedScreen> {
  const mounted = await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed: seedBasics });
  await ready();
  return mounted;
}

async function mountEdit(seed = seedEditable): Promise<MountedScreen> {
  setSearchParams({ id: expenseId(1) });
  const mounted = await mountScreen(<EditExpenseScreen />, { clock: () => NOW, seed });
  await ready();
  return mounted;
}

const rowLabel = () => screen.getByTestId(RECEIPT_ROW_TEST_ID).props.accessibilityLabel as string;
const isSaveDisabled = () =>
  (screen.getByTestId(SAVE_TEST_ID).props.accessibilityState as { disabled: boolean }).disabled;

beforeEach(() => {
  resetRouter();
});
afterEach(() => setReceiptPickerForTests(null));

describe('the Receipt row', () => {
  it('invites a photo when there is none', async () => {
    await mountAdd();
    expect(rowLabel()).toBe(`${COPY.form.field.receipt}, ${COPY.form.field.receiptAdd}`);
  });

  it('attaches a photo to a new expense and queues it for upload, with the expense', async () => {
    const calls = pickerReturning({ status: 'picked', dataBase64: IMG });
    const { database } = await mountAdd();

    await userEvent.press(screen.getByTestId('keypad-5'));
    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));

    await waitFor(() =>
      expect(rowLabel()).toBe(`${COPY.form.field.receipt}, ${COPY.form.field.receiptAttached}`),
    );
    expect(calls).toEqual(['camera']);
    // A draft: nothing stored yet.
    expect(await database.getAllAsync('SELECT * FROM receipts', [])).toHaveLength(0);

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
    const queued = await outboxEntries(database);
    const row = await readReceipt(database, queued[0]!.recordId);
    expect(row).toMatchObject({ state: 'pending-upload', dataBase64: IMG });
  });

  it('chooses from the library too', async () => {
    const calls = pickerReturning({ status: 'picked', dataBase64: IMG });
    await mountAdd();
    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_CHOOSE_TEST_ID));
    await waitFor(() => expect(calls).toEqual(['library']));
  });

  it('leaves the form alone when the picker is cancelled', async () => {
    pickerReturning({ status: 'cancelled' });
    await mountAdd();
    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));
    // Sheet still up, nothing attached.
    expect(screen.getByTestId(RECEIPT_TAKE_TEST_ID)).toBeTruthy();
    await userEvent.press(screen.getByTestId('receipt-sheet-close'));
    expect(rowLabel()).toContain(COPY.form.field.receiptAdd);
  });

  it('says what to do when camera access is denied, and when the photo cannot be used', async () => {
    pickerReturning({ status: 'denied' });
    await mountAdd();
    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));
    expect(await screen.findByText(COPY.form.receipt.deniedCamera)).toBeTruthy();

    pickerReturning({ status: 'failed' });
    await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));
    expect(await screen.findByText(COPY.form.receipt.failed)).toBeTruthy();
  });
});

describe('editing the receipt of an existing expense', () => {
  it('shows the stored photo', async () => {
    await mountEdit(async (database) => {
      await seedEditable(database);
      await storeDownloaded(database, expenseId(1), IMG, 6, '2026-10-13T10:00:00.000Z');
    });
    await waitFor(() => expect(rowLabel()).toContain(COPY.form.field.receiptAttached));

    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    expect(screen.getByTestId(RECEIPT_IMAGE_TEST_ID).props.source).toEqual({
      uri: `data:image/jpeg;base64,${IMG}`,
    });
  });

  it('lets a photo-only change be saved, without queuing an empty expense update', async () => {
    pickerReturning({ status: 'picked', dataBase64: IMG });
    const { database } = await mountEdit();
    expect(isSaveDisabled()).toBe(true);

    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));
    await waitFor(() => expect(isSaveDisabled()).toBe(false));
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect(await readReceipt(database, expenseId(1))).toMatchObject({ state: 'pending-upload' }),
    );
    expect(await outboxEntries(database)).toHaveLength(0);
    expect(routerRecord.back).toBe(1);
  });

  it('removes a photo as a queued delete', async () => {
    const { database } = await mountEdit(async (database) => {
      await seedEditable(database);
      await storeDownloaded(database, expenseId(1), IMG, 6, '2026-10-13T10:00:00.000Z');
    });
    await waitFor(() => expect(rowLabel()).toContain(COPY.form.field.receiptAttached));

    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_REMOVE_TEST_ID));
    await waitFor(() => expect(rowLabel()).toContain(COPY.form.field.receiptAdd));
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect(await readReceipt(database, expenseId(1))).toMatchObject({
        state: 'pending-delete',
        dataBase64: null,
      }),
    );
  });

  it('asks before discarding an unsaved photo, and stores nothing if discarded', async () => {
    pickerReturning({ status: 'picked', dataBase64: IMG });
    const { database } = await mountEdit();
    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_TAKE_TEST_ID));
    await waitFor(() => expect(rowLabel()).toContain(COPY.form.field.receiptAttached));

    await userEvent.press(screen.getByTestId(CLOSE_TEST_ID));
    expect(await screen.findByText(CONFIRM_COPY.discard.title)).toBeTruthy();
    expect(routerRecord.back).toBe(0);

    await userEvent.press(screen.getByTestId('discard-dialog-confirm'));
    expect(await readReceipt(database, expenseId(1))).toBeNull();
  });

  it('for a photo taken on another device, says it is not downloaded when offline', async () => {
    await mountEdit(async (database) => {
      await seedEditable(database);
      await database.runAsync(
        `INSERT INTO receipts (expenseId, state, dataBase64, sizeBytes, updatedAt)
         VALUES (?, 'remote', NULL, 5000, '2026-10-13T10:00:00.000Z')`,
        [expenseId(1)],
      );
    });
    await waitFor(() => expect(rowLabel()).toContain(COPY.form.field.receiptAttached));

    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    // The default test transport refuses every request, which is what offline looks like.
    expect(await screen.findByText(COPY.form.receipt.unavailable)).toBeTruthy();
  });
});
