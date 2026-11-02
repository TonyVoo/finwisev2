import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { ingestNotifications, listRecent } from '@/capture/store';
import { clearCapture, peekCapture, stashCapture } from '@/capture/pendingCapture';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import {
  CATEGORY_ROW_TEST_ID,
  DATE_ROW_TEST_ID,
  NOTE_ROW_TEST_ID,
  SAVE_TEST_ID,
} from '@/expenses/ExpenseFormScreen';
import NewExpenseScreen from '../../app/(app)/expense/new';
import PaymentDetectionScreen, {
  DETECTION_STATUS_TEST_ID,
  DETECTION_TURN_ON_TEST_ID,
  SUGGESTION_ROW_TEST_ID_PREFIX,
} from '../../app/(app)/settings/payment-detection';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

const native = {
  supported: true,
  enabled: false,
  opened: 0,
};
jest.mock('@/capture/native', () => ({
  paymentNotificationsSupported: () => native.supported,
  paymentNotificationsEnabled: () => native.enabled,
  openPaymentNotificationSettings: () => {
    native.opened += 1;
  },
  drainPaymentNotifications: () => [],
}));

const MOMO = 'com.mservice.momotransfer';
const T = new Date(2026, 9, 14, 8, 30).getTime();
const NOW = new Date(2026, 9, 14, 9, 0, 0);

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'VND',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: categoryId(1), name: 'Food', color: '#2F8044' });
  await ingestNotifications(database, [
    {
      packageName: MOMO,
      title: 'Thanh toán thành công',
      text: 'Bạn đã thanh toán 65.000đ tại Circle K',
      postTime: T,
    },
  ]);
}

beforeEach(() => {
  resetRouter();
  clearCapture();
  native.supported = true;
  native.enabled = false;
  native.opened = 0;
});

describe('the Payment detection screen', () => {
  it('says it is off and sends the person to Android settings to turn it on', async () => {
    await mountScreen(<PaymentDetectionScreen />, { clock: () => NOW, seed });

    expect(screen.getByTestId(DETECTION_STATUS_TEST_ID).props.children).toBe(
      COPY.paymentDetection.statusOff,
    );
    await userEvent.press(screen.getByTestId(DETECTION_TURN_ON_TEST_ID));
    expect(native.opened).toBe(1);
  });

  it('shows no switch once it is on', async () => {
    native.enabled = true;
    await mountScreen(<PaymentDetectionScreen />, { clock: () => NOW, seed });

    expect(screen.getByTestId(DETECTION_STATUS_TEST_ID).props.children).toBe(
      COPY.paymentDetection.statusOn,
    );
    expect(screen.queryByTestId(DETECTION_TURN_ON_TEST_ID)).toBeNull();
  });

  it('says it is Android only where the service does not exist', async () => {
    native.supported = false;
    await mountScreen(<PaymentDetectionScreen />, { clock: () => NOW, seed });

    expect(screen.getByText(COPY.paymentDetection.unsupported)).toBeTruthy();
    expect(screen.queryByTestId(DETECTION_STATUS_TEST_ID)).toBeNull();
  });

  it('lists a detected payment and logs what the phone read', async () => {
    await mountScreen(<PaymentDetectionScreen />, { clock: () => NOW, seed });

    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-0`)).not.toBeNull(),
    );
    expect(screen.getByText('Circle K')).toBeTruthy();
    expect(screen.getAllByTestId('detection-log-row')).toHaveLength(1);
  });

  it('opens Add expense with the payment filled in when Add is tapped', async () => {
    await mountScreen(<PaymentDetectionScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-add-0`)).not.toBeNull(),
    );

    await userEvent.press(screen.getByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-add-0`));

    expect(routerRecord.push).toContainEqual('/(app)/expense/new');
    expect(peekCapture()).toMatchObject({
      kind: 'expense',
      amountMinor: 65000,
      currency: 'VND',
      note: 'Circle K',
      date: '2026-10-14',
    });
  });

  it('files it under the category that name was filed under before', async () => {
    await mountScreen(<PaymentDetectionScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seed(db);
        await seedExpense(db, {
          id: expenseId(1),
          categoryId: categoryId(1),
          amountMinor: 50000,
          currency: 'VND',
          date: '2026-10-01',
          note: 'circle k',
        });
      },
    });
    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-add-0`)).not.toBeNull(),
    );

    await userEvent.press(screen.getByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-add-0`));

    await waitFor(() => expect(peekCapture()?.categoryId).toBe(categoryId(1)));
  });

  it('drops a payment on Dismiss, adding nothing', async () => {
    const { database } = await mountScreen(<PaymentDetectionScreen />, { clock: () => NOW, seed });
    await waitFor(() =>
      expect(screen.queryByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-dismiss-0`)).not.toBeNull(),
    );

    await userEvent.press(screen.getByTestId(`${SUGGESTION_ROW_TEST_ID_PREFIX}-dismiss-0`));

    await waitFor(() => expect(screen.queryByTestId('detection-empty')).not.toBeNull());
    expect((await listRecent(database))[0]?.status).toBe('dismissed');
    expect(await outboxEntries(database)).toEqual([]);
  });
});

describe('Add expense opened from a detected payment', () => {
  it('is filled in, and saving marks the payment as added', async () => {
    const { database } = await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: async (db) => {
        await seed(db);
        const [row] = await listRecent(db);
        stashCapture({
          id: row!.id,
          kind: 'expense',
          amountMinor: 65000,
          currency: 'VND',
          note: 'Circle K',
          date: '2026-10-14',
          categoryId: categoryId(1),
        });
      },
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
    expect(
      screen.getByTestId(CATEGORY_ROW_TEST_ID, { includeHiddenElements: true }).props
        .accessibilityLabel,
    ).toContain('Food');

    const label = (id: string) =>
      screen.getByTestId(id, { includeHiddenElements: true }).props.accessibilityLabel as string;
    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('65,000');
    expect(label(NOTE_ROW_TEST_ID)).toContain('Circle K');
    expect(label(DATE_ROW_TEST_ID)).toBeTruthy();

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect((await outboxEntries(database)).some((entry) => entry.entity === 'expense')).toBe(
        true,
      ),
    );
    const [row] = await listRecent(database);
    expect(row).toMatchObject({ status: 'added' });
    expect(row?.expenseId).not.toBeNull();
    expect(peekCapture()).toBeNull();
  });
});
