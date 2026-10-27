import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../bootstrap/AppProviders';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { queryKeys } from '../query/keys';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { storeDownloaded, type ReceiptRow } from './receiptStore';

/**
 * The receipt sheet: see the photo, take or choose another, or remove it.
 *
 * It shows what the form currently holds, not what is stored: in add mode nothing is stored
 * yet, and in edit mode a photo chosen a moment ago is only a draft until Save. The one
 * thing it fetches itself is a photo another device took, whose bytes are not on this device
 * until someone opens it - that is the only network call here, and offline it says so
 * instead of showing an empty box.
 */

export const RECEIPT_SHEET_TEST_ID = 'receipt-sheet';
export const RECEIPT_IMAGE_TEST_ID = 'receipt-image';
export const RECEIPT_TAKE_TEST_ID = 'receipt-take';
export const RECEIPT_CHOOSE_TEST_ID = 'receipt-choose';
export const RECEIPT_REMOVE_TEST_ID = 'receipt-remove';

export interface ReceiptSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly expenseId: string | null;
  /** The stored row, for the download of a photo this device has not fetched. */
  readonly stored: ReceiptRow | null;
  /** The image the form would save, base64, or null when it would have no receipt. */
  readonly dataBase64: string | null;
  /** True while the form's choice is "this expense will have a receipt" but bytes are absent. */
  readonly present: boolean;
  readonly onTake: () => void;
  readonly onChoose: () => void;
  readonly onRemove: () => void;
}

export function ReceiptSheet(props: ReceiptSheetProps) {
  const { visible, onClose, expenseId, stored, dataBase64, present } = props;
  const styles = useStyles();
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const [fetchFailed, setFetchFailed] = useState(false);

  const needsDownload =
    visible && present && dataBase64 === null && stored?.state === 'remote' && expenseId !== null;

  useEffect(() => {
    if (!needsDownload || expenseId === null) return;
    let cancelled = false;
    setFetchFailed(false);
    void api
      .getReceipt(expenseId)
      .then(async ({ data }) => {
        if (cancelled) return;
        await storeDownloaded(database, expenseId, data.dataBase64, data.sizeBytes, data.updatedAt);
        await queryClient.invalidateQueries({ queryKey: queryKeys.receipts.detail(expenseId) });
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsDownload, expenseId, api, database, queryClient]);

  return (
    <Sheet
      visible={visible}
      title={COPY.form.receipt.title}
      onClose={onClose}
      testID={RECEIPT_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        {dataBase64 !== null ? (
          <Image
            testID={RECEIPT_IMAGE_TEST_ID}
            source={{ uri: `data:image/jpeg;base64,${dataBase64}` }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={COPY.form.receipt.imageLabel}
          />
        ) : present ? (
          <Text style={styles.status}>
            {fetchFailed ? COPY.form.receipt.unavailable : COPY.form.receipt.loading}
          </Text>
        ) : null}

        <Button
          label={COPY.form.receipt.take}
          onPress={props.onTake}
          variant="secondary"
          fullWidth
          testID={RECEIPT_TAKE_TEST_ID}
        />
        <Button
          label={COPY.form.receipt.choose}
          onPress={props.onChoose}
          variant="secondary"
          fullWidth
          testID={RECEIPT_CHOOSE_TEST_ID}
        />
        {present ? (
          <Button
            label={COPY.form.receipt.remove}
            onPress={props.onRemove}
            variant="ghost"
            tone="danger"
            fullWidth
            testID={RECEIPT_REMOVE_TEST_ID}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[3], paddingBottom: space[2] },
    image: {
      width: '100%',
      height: 280,
      borderRadius: radius.md,
      backgroundColor: color.bg.sunken,
    },
    status: {
      ...type.body,
      color: color.text.secondary,
      textAlign: 'center',
      paddingVertical: space[4],
    },
  }),
);
