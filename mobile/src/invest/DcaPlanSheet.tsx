import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { savedHaptic, warnHaptic } from '../lib/haptics';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { type DcaPlan, MAX_DAY, MIN_DAY, type PlanInput, lotsFor } from './dca';
import { cleanSymbol, fillTemplate, formatDong, groupDigits, parseWhole } from './investModel';

/**
 * Create and edit a monthly plan: which stock, how much a month, and which day. Under the fields it says what the
 * amount buys at the last price, in whole lots of 100, so the amount can be tuned until it buys what is wanted; and
 * an existing plan can go straight to recording this month's buy.
 */

export const PLAN_SHEET_TEST_ID = 'dca-sheet';
export const PLAN_SYMBOL_TEST_ID = 'dca-symbol';
export const PLAN_AMOUNT_TEST_ID = 'dca-amount';
export const PLAN_DAY_TEST_ID = 'dca-day';
export const PLAN_PREVIEW_TEST_ID = 'dca-preview';
export const PLAN_SAVE_TEST_ID = 'dca-save';
export const PLAN_RECORD_TEST_ID = 'dca-record';
export const PLAN_DELETE_TEST_ID = 'dca-delete';

export function DcaPlanSheet({
  visible,
  onClose,
  editing,
  closes,
  onSave,
  onRecord,
  onDelete,
  onSymbolChange,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly editing: DcaPlan | null;
  /** The last close of each symbol known, for the preview. */
  readonly closes: Readonly<Record<string, number | null>>;
  readonly onSave: (input: PlanInput, editingId: string | null) => Promise<void>;
  /** Record this month's buy: the plan, with the shares and price it suggests. */
  readonly onRecord?: (plan: DcaPlan, shares: number, price: number | null) => void;
  readonly onDelete?: () => void;
  /** The symbol typed so far, or null while it is not a ticker: so the screen can fetch a price to preview with. */
  readonly onSymbolChange?: (symbol: string | null) => void;
}) {
  const styles = useStyles();
  const [symbolText, setSymbolText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dayText, setDayText] = useState('');
  const [errors, setErrors] = useState<{ symbol?: string; amount?: string; day?: string }>({});
  const seeded = useRef(false);

  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setErrors({});
    setSymbolText(editing?.symbol ?? '');
    setAmountText(editing === null ? '' : groupDigits(String(editing.amount)));
    setDayText(editing === null ? '5' : String(editing.day));
  }, [visible, editing]);

  const symbol = cleanSymbol(symbolText);
  const amount = parseWhole(amountText);
  useEffect(() => {
    onSymbolChange?.(visible ? symbol : null);
  }, [symbol, visible]);

  const close = symbol === null ? null : (closes[symbol] ?? null);
  const lots = amount !== null && close !== null ? lotsFor(amount, close) : null;

  function read(): { input: PlanInput } | null {
    const day = /^\d{1,2}$/.test(dayText.trim()) ? Number(dayText.trim()) : NaN;
    const next: typeof errors = {};
    if (symbol === null) next.symbol = COPY.portfolio.symbolError;
    if (amount === null || amount > 1_000_000_000_000) next.amount = COPY.portfolio.dcaAmountError;
    if (!(day >= MIN_DAY && day <= MAX_DAY)) next.day = COPY.portfolio.dcaDayError;
    setErrors(next);
    if (Object.keys(next).length > 0 || symbol === null || amount === null) return null;
    return { input: { symbol, amount, day } };
  }

  function submit(): void {
    const read_ = read();
    if (read_ === null) {
      warnHaptic();
      return;
    }
    savedHaptic();
    void onSave(read_.input, editing?.id ?? null);
  }

  return (
    <Sheet
      visible={visible}
      title={editing === null ? COPY.portfolio.dcaNewTitle : COPY.portfolio.dcaEditTitle}
      onClose={onClose}
      testID={PLAN_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextField
          testID={PLAN_SYMBOL_TEST_ID}
          label={COPY.portfolio.symbol}
          value={symbolText}
          onChangeText={(text) => setSymbolText(text.toUpperCase())}
          error={errors.symbol}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          editable={editing === null}
        />
        <TextField
          testID={PLAN_AMOUNT_TEST_ID}
          label={COPY.portfolio.dcaAmount}
          value={amountText}
          onChangeText={(text) => setAmountText(groupDigits(text))}
          error={errors.amount}
          keyboardType="number-pad"
        />
        <TextField
          testID={PLAN_DAY_TEST_ID}
          label={COPY.portfolio.dcaDay}
          value={dayText}
          onChangeText={setDayText}
          error={errors.day}
          keyboardType="number-pad"
          maxLength={2}
        />

        {close !== null && amount !== null ? (
          <Text testID={PLAN_PREVIEW_TEST_ID} style={styles.preview}>
            {lots !== null && lots.shares > 0
              ? fillTemplate(COPY.portfolio.dcaPreview, {
                  price: formatDong(close),
                  shares: groupDigits(String(lots.shares)),
                  cost: formatDong(lots.cost),
                })
              : fillTemplate(COPY.portfolio.dcaTooLittle, { price: formatDong(close) })}
          </Text>
        ) : null}

        <Button
          testID={PLAN_SAVE_TEST_ID}
          label={COPY.portfolio.dcaSave}
          variant="primary"
          fullWidth
          onPress={submit}
        />
        {editing !== null && onRecord !== undefined ? (
          <Button
            testID={PLAN_RECORD_TEST_ID}
            label={COPY.portfolio.dcaRecord}
            variant="secondary"
            fullWidth
            onPress={() => onRecord(editing, lots?.shares ?? 0, close)}
          />
        ) : null}
        {onDelete === undefined ? null : (
          <Button
            testID={PLAN_DELETE_TEST_ID}
            label={COPY.common.delete}
            variant="ghost"
            tone="danger"
            fullWidth
            onPress={onDelete}
          />
        )}
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[3], paddingBottom: space[4] },
    preview: {
      ...type.callout,
      color: color.text.primary,
      padding: space[3],
      borderRadius: radius.md,
      backgroundColor: color.primary.subtle,
    },
  }),
);
