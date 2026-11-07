import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { keyHaptic, savedHaptic, warnHaptic } from '../lib/haptics';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import type { AlertDirection } from './alerts';
import { formatDong, groupDigits, parseWhole } from './investModel';

/**
 * Set a price alert for the stock being looked at: above or below a price. The price starts five percent away from
 * the last close in the chosen direction, which is a sensible first guess to edit rather than a blank to fill.
 */

export const ALERT_SHEET_TEST_ID = 'alert-sheet';
export const ALERT_ABOVE_TEST_ID = 'alert-above';
export const ALERT_BELOW_TEST_ID = 'alert-below';
export const ALERT_PRICE_TEST_ID = 'alert-price';
export const ALERT_SAVE_TEST_ID = 'alert-save';

/** Five percent past `close` in a direction, as whole dong. */
export function suggestedAlertPrice(close: number | null, direction: AlertDirection): string {
  if (close === null) return '';
  return groupDigits(String(Math.round(close * (direction === 'above' ? 1.05 : 0.95))));
}

export function AlertSheet({
  visible,
  onClose,
  symbol,
  close,
  onSave,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly symbol: string;
  readonly close: number | null;
  readonly onSave: (direction: AlertDirection, price: number) => Promise<void>;
}) {
  const styles = useStyles();
  const color = useColors();
  const [direction, setDirection] = useState<AlertDirection>('above');
  const [priceText, setPriceText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const seeded = useRef(false);

  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setDirection('above');
    setPriceText(suggestedAlertPrice(close, 'above'));
    setError(undefined);
  }, [visible, close]);

  function choose(next: AlertDirection): void {
    keyHaptic();
    setDirection(next);
    setPriceText(suggestedAlertPrice(close, next));
  }

  function submit(): void {
    const price = parseWhole(priceText);
    if (price === null || price > 1_000_000_000) {
      warnHaptic();
      setError(COPY.invest.alertPriceError);
      return;
    }
    savedHaptic();
    void onSave(direction, price);
  }

  return (
    <Sheet
      visible={visible}
      title={`${COPY.invest.alertAdd} · ${symbol}`}
      onClose={onClose}
      testID={ALERT_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['above', 'below'] as const).map((side) => {
            const selected = direction === side;
            const fill = side === 'above' ? color.success.default : color.danger.default;
            return (
              <Pressable
                key={side}
                testID={side === 'above' ? ALERT_ABOVE_TEST_ID : ALERT_BELOW_TEST_ID}
                onPress={() => choose(side)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.option, selected ? { backgroundColor: fill } : null]}
              >
                <Text style={[styles.optionText, selected ? { color: color.text.inverse } : null]}>
                  {side === 'above' ? COPY.invest.alertAbove : COPY.invest.alertBelow}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          testID={ALERT_PRICE_TEST_ID}
          label={COPY.invest.alertPrice}
          value={priceText}
          onChangeText={(text) => {
            setPriceText(groupDigits(text));
            setError(undefined);
          }}
          error={error}
          keyboardType="number-pad"
          helper={close === null ? undefined : formatDong(close)}
        />
        <Text style={styles.hint}>{COPY.invest.alertHint}</Text>
        <Button
          testID={ALERT_SAVE_TEST_ID}
          label={COPY.invest.alertSave}
          variant="primary"
          fullWidth
          onPress={submit}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[4], paddingBottom: space[4] },
    segment: {
      flexDirection: 'row',
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: color.bg.sunken,
    },
    option: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: space[2] + 2,
      borderRadius: radius.pill,
    },
    optionText: { ...type.bodyStrong, color: color.text.secondary },
    hint: { ...type.footnote, color: color.text.tertiary },
  }),
);
