import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { isValidRate } from '../lib/conversion';
import { space } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * Type the exchange rate yourself. The fallback when the lookup fails or the phone is
 * offline - and the way to use the rate the bank or card actually charged, which is rarely
 * the reference rate to the last decimal.
 *
 * Done keeps what was typed and does not save the expense, like the note sheet: the rate is
 * one field of a form that has its own Save. A rate that is not a plain positive decimal is
 * refused here with the reason, rather than leaving Save disabled with nothing to explain it.
 */

export const RATE_SHEET_TEST_ID = 'expense-rate-sheet';
export const RATE_INPUT_TEST_ID = 'expense-rate-input';
export const RATE_DONE_TEST_ID = 'expense-rate-done';

export function RateSheet({
  visible,
  onClose,
  rate,
  hint,
  onDone,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly rate: string;
  /** `1 EUR = ? USD`, so the person knows which way round the rate goes. */
  readonly hint: string;
  readonly onDone: (rate: string) => void;
}) {
  const styles = useStyles();
  const [draft, setDraft] = useState(rate);
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-seeded on each presentation, for the reason the note sheet gives.
  useEffect(() => {
    if (visible) {
      setDraft(rate);
      setError(undefined);
    }
  }, [visible, rate]);

  const done = () => {
    // A comma is a decimal mark on many keyboards; the contract's is a point.
    const text = draft.trim().replace(',', '.');
    if (!isValidRate(text)) {
      setError(COPY.form.rate.invalid);
      return;
    }
    onDone(text);
  };

  return (
    <Sheet
      visible={visible}
      title={COPY.form.rate.label}
      onClose={onClose}
      testID={RATE_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextField
          testID={RATE_INPUT_TEST_ID}
          label={COPY.form.rate.label}
          value={draft}
          onChangeText={(next) => {
            setDraft(next);
            setError(undefined);
          }}
          helper={hint}
          error={error}
          keyboardType="decimal-pad"
          autoFocus
        />
        <Button
          testID={RATE_DONE_TEST_ID}
          label={COPY.form.noteDone}
          variant="primary"
          fullWidth
          onPress={done}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    body: { gap: space[4], paddingBottom: space[4] },
  }),
);
