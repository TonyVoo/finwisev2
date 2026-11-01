import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { useSnackbar } from '../components/Snackbar';
import { COPY } from '../copy/strings';
import { stashPhoto } from './pendingPhoto';
import { getReceiptPicker } from './receiptPicker';

/**
 * The camera button in the tab bar: take a photo of a receipt, then open Add expense with it attached.
 *
 * Nothing is sent anywhere here. The photo is only held until the form opens, and it leaves the phone
 * only if the person taps **Read receipt** there (`docs/design/11-receipt-scan.md`), under the
 * disclosure that button carries.
 */
export function useScanShortcut(): { readonly start: () => Promise<void> } {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  // The camera is a full-screen takeover, but a second tap can land before it is up.
  const busy = useRef(false);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const outcome = await getReceiptPicker().takePhoto();
      if (outcome.status === 'picked') {
        stashPhoto(outcome.dataBase64);
        router.push('/(app)/expense/new');
      } else if (outcome.status === 'denied') {
        showSnackbar({ message: COPY.form.receipt.deniedCamera });
      } else if (outcome.status === 'failed') {
        showSnackbar({ message: COPY.form.receipt.failed });
      }
    } finally {
      busy.current = false;
    }
  }, [router, showSnackbar]);

  return { start };
}
