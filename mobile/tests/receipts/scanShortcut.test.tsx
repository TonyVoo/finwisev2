import { Pressable } from 'react-native';
import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { clearStashedPhoto, peekStashedPhoto } from '@/receipts/pendingPhoto';
import { setReceiptPickerForTests, type PickOutcome } from '@/receipts/receiptPicker';
import { useScanShortcut } from '@/receipts/useScanShortcut';
import { resetRouter, routerRecord } from '../support/router';
import { mountScreen } from '../support/mount';

jest.mock('expo-router');

function Probe() {
  const { start } = useScanShortcut();
  return <Pressable testID="probe" onPress={() => void start()} />;
}

function picker(outcome: PickOutcome | Promise<PickOutcome>) {
  const calls: string[] = [];
  setReceiptPickerForTests({
    takePhoto: async () => {
      calls.push('camera');
      return await outcome;
    },
    chooseFromLibrary: async () => {
      calls.push('library');
      return await outcome;
    },
  });
  return calls;
}

beforeEach(() => {
  resetRouter();
  clearStashedPhoto();
});
afterEach(() => setReceiptPickerForTests(null));

describe('the camera shortcut', () => {
  it('opens the camera, then Add expense with the photo waiting for it', async () => {
    const calls = picker({ status: 'picked', dataBase64: 'AAAA' });
    await mountScreen(<Probe />);

    await userEvent.press(screen.getByTestId('probe'));

    await waitFor(() => expect(routerRecord.push).toEqual(['/(app)/expense/new']));
    expect(calls).toEqual(['camera']);
    expect(peekStashedPhoto()).toBe('AAAA');
  });

  it('does nothing more when the camera is closed without a photo', async () => {
    picker({ status: 'cancelled' });
    await mountScreen(<Probe />);

    await userEvent.press(screen.getByTestId('probe'));

    await waitFor(() => expect(peekStashedPhoto()).toBeNull());
    expect(routerRecord.push).toEqual([]);
  });

  it('says why when the camera is not allowed, and goes nowhere', async () => {
    picker({ status: 'denied' });
    await mountScreen(<Probe />);

    await userEvent.press(screen.getByTestId('probe'));

    await waitFor(() => expect(screen.queryByText(COPY.form.receipt.deniedCamera)).not.toBeNull());
    expect(routerRecord.push).toEqual([]);
  });

  it('says so when the photo could not be prepared, and goes nowhere', async () => {
    picker({ status: 'failed' });
    await mountScreen(<Probe />);

    await userEvent.press(screen.getByTestId('probe'));

    await waitFor(() => expect(screen.queryByText(COPY.form.receipt.failed)).not.toBeNull());
    expect(routerRecord.push).toEqual([]);
  });

  it('ignores a second tap while the camera is open', async () => {
    let finish: (outcome: PickOutcome) => void = () => undefined;
    const calls = picker(new Promise<PickOutcome>((resolve) => (finish = resolve)));
    await mountScreen(<Probe />);

    await userEvent.press(screen.getByTestId('probe'));
    await userEvent.press(screen.getByTestId('probe'));
    finish({ status: 'picked', dataBase64: 'AAAA' });

    await waitFor(() => expect(routerRecord.push).toHaveLength(1));
    expect(calls).toEqual(['camera']);
  });
});
