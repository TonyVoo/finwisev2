import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import type { NewTrade } from '../db/mutations';
import type { TradeListItem } from '../db/queries';
import { keyHaptic, savedHaptic, warnHaptic } from '../lib/haptics';
import { stepDay } from '../lib/calendar';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { SymbolAvatar } from './SymbolAvatar';
import { fillTemplate, formatDong, groupDigits, parseWhole } from './investModel';
import {
  type TradeDraft,
  type TradeErrors,
  draftFromTrade,
  emptyTradeDraft,
  validateTradeDraft,
} from './tradeModel';

/**
 * Add and edit a trade. One sheet for both, as the goal and recurring sheets are.
 *
 * Built to be entered fast and checked at a glance: Buy and Sell are one segmented control, green and red as the
 * market is; shares and prices group their thousands as they are typed; the symbol offers what you already hold
 * and watch; the date is one tap for today or yesterday and a typed day otherwise; selling says how many you hold;
 * and the total of the trade, fee included, is worked out under the fields before you commit to it.
 */

export const TRADE_SHEET_TEST_ID = 'trade-sheet';
export const TRADE_SIDE_BUY_TEST_ID = 'trade-side-buy';
export const TRADE_SIDE_SELL_TEST_ID = 'trade-side-sell';
export const TRADE_SYMBOL_TEST_ID = 'trade-symbol';
export const TRADE_QUANTITY_TEST_ID = 'trade-quantity';
export const TRADE_PRICE_TEST_ID = 'trade-price';
export const TRADE_FEE_TEST_ID = 'trade-fee';
export const TRADE_DATE_TEST_ID = 'trade-date';
export const TRADE_NOTE_TEST_ID = 'trade-note';
export const TRADE_TOTAL_TEST_ID = 'trade-total';
export const TRADE_HOLD_TEST_ID = 'trade-hold';
export const TRADE_SIDE_DIVIDEND_TEST_ID = 'trade-side-dividend';
export const TRADE_SUBMIT_TEST_ID = 'trade-submit';
export const TRADE_DELETE_TEST_ID = 'trade-delete';
export const TRADE_TODAY_TEST_ID = 'trade-date-today';
export const TRADE_YESTERDAY_TEST_ID = 'trade-date-yesterday';

export interface TradeFormSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly editing: TradeListItem | null;
  readonly today: string;
  /** A symbol to start a new trade with, e.g. the one being viewed. */
  readonly initialSymbol?: string;
  /** More to start a new trade with, e.g. the shares and price a monthly plan suggests. */
  readonly initialDraft?: Partial<TradeDraft>;
  /** Symbols to offer under the field: what is held, then what is watched. */
  readonly suggestions?: readonly string[];
  /** Shares held per symbol, for the hint when selling. */
  readonly held?: Readonly<Record<string, number>>;
  readonly onSubmit: (value: NewTrade) => Promise<void>;
  readonly onDelete?: () => void;
}

/** What the trade comes to in dong: shares times price, plus the fee on a buy and less it on a sell. */
export function tradeTotal(draft: TradeDraft): number | null {
  const quantity = parseWhole(draft.quantityText);
  const price = parseWhole(draft.priceText);
  if (quantity === null || price === null) return null;
  const fee = parseWhole(draft.feeText) ?? 0;
  const gross = quantity * price;
  // A buy costs its fee on top; a sale and a dividend lose it from what comes in.
  return draft.side === 'buy' ? gross + fee : gross - fee;
}

/** The word for a side, in the person's language. */
export function sideLabel(side: 'buy' | 'sell' | 'dividend'): string {
  return side === 'buy'
    ? COPY.portfolio.buy
    : side === 'sell'
      ? COPY.portfolio.sell
      : COPY.portfolio.dividend;
}

export function TradeFormSheet({
  visible,
  onClose,
  editing,
  today,
  initialSymbol,
  initialDraft,
  suggestions = [],
  held = {},
  onSubmit,
  onDelete,
}: TradeFormSheetProps) {
  const styles = useStyles();
  const color = useColors();
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [errors, setErrors] = useState<TradeErrors>({});
  const seeded = useRef(false);

  // Seeded once per presentation: re-seeding an open sheet when a sync lands would reset what was typed.
  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setErrors({});
    setDraft(
      editing === null
        ? { ...emptyTradeDraft(today), symbolText: initialSymbol ?? '', ...initialDraft }
        : draftFromTrade(editing),
    );
  }, [visible, editing, today, initialSymbol, initialDraft]);

  const isEdit = editing !== null;
  const title = isEdit ? COPY.portfolio.editTitle : COPY.portfolio.newTitle;

  if (draft === null) {
    return (
      <Sheet visible={visible} title={title} onClose={onClose} testID={TRADE_SHEET_TEST_ID}>
        <View />
      </Sheet>
    );
  }

  const set = (patch: Partial<TradeDraft>) =>
    setDraft((current) => (current === null ? current : { ...current, ...patch }));

  const submit = () => {
    const result = validateTradeDraft(draft);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) {
      savedHaptic();
      void onSubmit(result.value);
    } else {
      warnHaptic();
    }
  };

  const total = tradeTotal(draft);
  const symbol = draft.symbolText.trim().toUpperCase();
  const holding = held[symbol];
  const buy = draft.side === 'buy';
  const dividend = draft.side === 'dividend';
  const offered = suggestions.filter((item) => item !== symbol).slice(0, 6);
  const yesterday = stepDay(today, -1);

  return (
    <Sheet visible={visible} title={title} onClose={onClose} testID={TRADE_SHEET_TEST_ID}>
      <View style={styles.body}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['buy', 'sell', 'dividend'] as const).map((side) => {
            const selected = draft.side === side;
            const fill =
              side === 'buy'
                ? color.success.default
                : side === 'sell'
                  ? color.danger.default
                  : color.info.default;
            return (
              <Pressable
                key={side}
                testID={
                  side === 'buy'
                    ? TRADE_SIDE_BUY_TEST_ID
                    : side === 'sell'
                      ? TRADE_SIDE_SELL_TEST_ID
                      : TRADE_SIDE_DIVIDEND_TEST_ID
                }
                onPress={() => {
                  keyHaptic();
                  set({ side });
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={[styles.option, selected ? { backgroundColor: fill } : null]}
              >
                <Text style={[styles.optionText, selected ? { color: color.text.inverse } : null]}>
                  {sideLabel(side)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View>
          <TextField
            testID={TRADE_SYMBOL_TEST_ID}
            label={COPY.portfolio.symbol}
            value={draft.symbolText}
            onChangeText={(text) => set({ symbolText: text.toUpperCase() })}
            error={errors.symbol}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
            autoFocus={!isEdit && (initialSymbol ?? '') === ''}
          />
          {offered.length > 0 && !isEdit ? (
            <View style={styles.chips}>
              {offered.map((item) => (
                <Pressable
                  key={item}
                  testID={`trade-suggest-${item}`}
                  onPress={() => {
                    keyHaptic();
                    set({ symbolText: item });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={item}
                  style={styles.chip}
                >
                  <SymbolAvatar symbol={item} size={20} />
                  <Text style={styles.chipText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.pair}>
          <View style={styles.half}>
            <TextField
              testID={TRADE_QUANTITY_TEST_ID}
              label={dividend ? COPY.portfolio.quantityDividend : COPY.portfolio.quantity}
              value={draft.quantityText}
              onChangeText={(text) => set({ quantityText: groupDigits(text) })}
              error={errors.quantity}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.half}>
            <TextField
              testID={TRADE_PRICE_TEST_ID}
              label={dividend ? COPY.portfolio.priceDividend : COPY.portfolio.price}
              value={draft.priceText}
              onChangeText={(text) => set({ priceText: groupDigits(text) })}
              error={errors.price}
              keyboardType="number-pad"
            />
          </View>
        </View>
        {!buy && holding !== undefined && holding > 0 ? (
          <Text testID={TRADE_HOLD_TEST_ID} style={styles.hint}>
            {fillTemplate(COPY.portfolio.youHold, { count: groupDigits(String(holding)) })}
          </Text>
        ) : null}

        <View style={styles.pair}>
          <View style={styles.half}>
            <TextField
              testID={TRADE_FEE_TEST_ID}
              label={dividend ? COPY.portfolio.feeDividend : COPY.portfolio.fee}
              value={draft.feeText}
              onChangeText={(text) => set({ feeText: groupDigits(text) })}
              error={errors.fee}
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.half}>
            <TextField
              testID={TRADE_DATE_TEST_ID}
              label={COPY.portfolio.date}
              value={draft.dateText}
              onChangeText={(dateText) => set({ dateText })}
              error={errors.date}
              autoCorrect={false}
              maxLength={10}
            />
          </View>
        </View>
        <View style={styles.chips}>
          {(
            [
              [TRADE_TODAY_TEST_ID, COPY.home.section.today, today],
              [TRADE_YESTERDAY_TEST_ID, COPY.home.section.yesterday, yesterday],
            ] as const
          ).map(([id, label, value]) => (
            <Pressable
              key={id}
              testID={id}
              onPress={() => {
                keyHaptic();
                set({ dateText: value });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.dateText === value }}
              style={[styles.chip, draft.dateText === value ? styles.chipOn : null]}
            >
              <Text style={styles.chipText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <TextField
          testID={TRADE_NOTE_TEST_ID}
          label={COPY.portfolio.note}
          value={draft.noteText}
          onChangeText={(noteText) => set({ noteText })}
          maxLength={200}
        />

        <View style={styles.total} testID={TRADE_TOTAL_TEST_ID} accessibilityLiveRegion="polite">
          <Text style={styles.totalLabel}>{COPY.portfolio.total}</Text>
          <Text style={styles.totalValue}>{total === null ? '—' : formatDong(total)}</Text>
        </View>

        <Button
          testID={TRADE_SUBMIT_TEST_ID}
          label={COPY.portfolio.save}
          variant="primary"
          fullWidth
          onPress={submit}
        />
        {onDelete === undefined ? null : (
          <Button
            testID={TRADE_DELETE_TEST_ID}
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
    body: { gap: space[3], paddingBottom: space[2] },
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
    pair: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
    half: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[1] + 2 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1] + 2,
      paddingVertical: space[1] + 2,
      paddingHorizontal: space[3],
      borderRadius: radius.pill,
      backgroundColor: color.bg.sunken,
    },
    chipOn: { backgroundColor: color.primary.subtle },
    chipText: { ...type.subhead, color: color.text.primary },
    hint: { ...type.footnote, color: color.text.secondary, marginTop: -space[2] },
    total: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingVertical: space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.md,
      backgroundColor: color.bg.sunken,
    },
    totalLabel: { ...type.subhead, color: color.text.secondary },
    totalValue: { ...type.title2, color: color.text.primary, fontVariant: ['tabular-nums'] },
  }),
);
