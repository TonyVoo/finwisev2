import { screen, userEvent } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import {
  RECEIPT_CARD_CHOOSE_TEST_ID,
  RECEIPT_CARD_RETAKE_TEST_ID,
  RECEIPT_CARD_TAKE_TEST_ID,
  RECEIPT_CARD_THUMB_TEST_ID,
  RECEIPT_SCANNING_TEST_ID,
  ReceiptCard,
  type ReceiptCardProps,
} from '@/receipts/ReceiptCard';
import { RECEIPT_ROW_TEST_ID, RECEIPT_SCAN_TEST_ID } from '@/receipts/ReceiptCard';
import { mountScreen } from '../support/mount';

/**
 * The Receipt card on the expense form: two big tiles when there is no photo (one tap to the camera or the
 * library), and a thumbnail with Read receipt and Retake once there is one. The photo leaves the phone only
 * when Read receipt is tapped, under the sentence that says so.
 */

function handlers() {
  return { onOpen: jest.fn(), onTake: jest.fn(), onChoose: jest.fn(), onScan: jest.fn() };
}

async function mountCard(props: Partial<ReceiptCardProps> = {}) {
  const calls = handlers();
  await mountScreen(
    <ReceiptCard
      present={false}
      dataBase64={null}
      canScan
      scanning={false}
      {...calls}
      {...props}
    />,
  );
  return calls;
}

describe('with no photo', () => {
  it('offers the camera and the library as two tiles, each one tap', async () => {
    const calls = await mountCard();

    await userEvent.press(screen.getByTestId(RECEIPT_CARD_TAKE_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_CARD_CHOOSE_TEST_ID));

    expect(calls.onTake).toHaveBeenCalledTimes(1);
    expect(calls.onChoose).toHaveBeenCalledTimes(1);
  });

  it('says what a photo is for, and has nothing to read yet', async () => {
    await mountCard();

    expect(screen.getByText(COPY.form.receipt.pitch)).toBeTruthy();
    expect(screen.queryByTestId(RECEIPT_SCAN_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(RECEIPT_CARD_THUMB_TEST_ID)).toBeNull();
  });

  it('labels the header as an invitation, and opens the receipt sheet from it', async () => {
    const calls = await mountCard();

    expect(screen.getByTestId(RECEIPT_ROW_TEST_ID).props.accessibilityLabel).toBe(
      `${COPY.form.field.receipt}, ${COPY.form.field.receiptAdd}`,
    );
    await userEvent.press(screen.getByTestId(RECEIPT_ROW_TEST_ID));
    expect(calls.onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('with a photo', () => {
  it('shows it as a thumbnail, and says it is attached', async () => {
    await mountCard({ present: true, dataBase64: '/9j/AAAA' });

    expect(screen.getByTestId(RECEIPT_CARD_THUMB_TEST_ID)).toBeTruthy();
    expect(screen.getByTestId(RECEIPT_ROW_TEST_ID).props.accessibilityLabel).toBe(
      `${COPY.form.field.receipt}, ${COPY.form.field.receiptAttached}`,
    );
    expect(screen.queryByTestId(RECEIPT_CARD_TAKE_TEST_ID)).toBeNull();
  });

  it('offers Read receipt with the sentence about where the photo goes, and retaking', async () => {
    const calls = await mountCard({ present: true, dataBase64: '/9j/AAAA' });

    expect(screen.getByText(COPY.form.receipt.scan.hint)).toBeTruthy();
    await userEvent.press(screen.getByTestId(RECEIPT_SCAN_TEST_ID));
    await userEvent.press(screen.getByTestId(RECEIPT_CARD_RETAKE_TEST_ID));

    expect(calls.onScan).toHaveBeenCalledTimes(1);
    expect(calls.onTake).toHaveBeenCalledTimes(1);
  });

  it('does not offer reading when the server cannot, and says nothing about sending it', async () => {
    await mountCard({ present: true, dataBase64: '/9j/AAAA', canScan: false });

    expect(screen.queryByTestId(RECEIPT_SCAN_TEST_ID)).toBeNull();
    expect(screen.queryByText(COPY.form.receipt.scan.hint)).toBeNull();
  });

  it('shows a scan sweeping the photo while it is read, and the button says so', async () => {
    await mountCard({ present: true, dataBase64: '/9j/AAAA', scanning: true });

    expect(screen.getByTestId(RECEIPT_SCANNING_TEST_ID)).toBeTruthy();
    expect(screen.getByTestId(RECEIPT_SCAN_TEST_ID).props.accessibilityState).toMatchObject({
      busy: true,
    });
    expect(screen.getByTestId(RECEIPT_SCAN_TEST_ID).props.accessibilityLabel).toContain(
      COPY.form.receipt.scan.reading,
    );
  });

  it('shows no scan when not reading', async () => {
    await mountCard({ present: true, dataBase64: '/9j/AAAA' });

    expect(screen.queryByTestId(RECEIPT_SCANNING_TEST_ID)).toBeNull();
  });

  it('holds a place for a photo another device took, until it is fetched', async () => {
    await mountCard({ present: true, dataBase64: null });

    expect(screen.queryByTestId(RECEIPT_CARD_THUMB_TEST_ID)).toBeNull();
    expect(screen.getByTestId(RECEIPT_ROW_TEST_ID).props.accessibilityLabel).toBe(
      `${COPY.form.field.receipt}, ${COPY.form.field.receiptAttached}`,
    );
  });
});
