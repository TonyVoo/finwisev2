import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { formatMoney } from '../lib/money';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { budgetInputText } from '../categories/budgetInput';
import { resolveSplit, type SplitDraft, type SplitPart } from './splitModel';

export const SPLIT_SHEET_TEST_ID = 'split-sheet';
export const SPLIT_ADD_TEST_ID = 'split-add';
export const SPLIT_DONE_TEST_ID = 'split-done';
export const SPLIT_CLEAR_TEST_ID = 'split-clear';
export const SPLIT_LEFT_TEST_ID = 'split-left';
export const SPLIT_CATEGORY_TEST_ID_PREFIX = 'split-category';
export const SPLIT_AMOUNT_TEST_ID_PREFIX = 'split-amount';

const REASONS = {
  parts: () => COPY.split.reasonParts,
  category: () => COPY.split.reasonCategory,
  duplicate: () => COPY.split.reasonDuplicate,
  amount: () => COPY.split.reasonAmount,
  sum: () => COPY.split.reasonSum,
} as const;

export interface SplitCategory {
  readonly id: string;
  readonly name: string;
}

/**
 * Divide one amount between categories (`docs/design/29-split-expense.md`): a card per part with a category and an
 * amount, a line saying how much is left to assign, and Done once it adds up. One part may be left empty to take the
 * rest.
 */
export function SplitSheet({
  visible,
  onClose,
  totalMinor,
  currency,
  decimals,
  categories,
  current,
  firstCategoryId,
  onApply,
  onClear,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly totalMinor: number;
  readonly currency: string;
  readonly decimals: number;
  readonly categories: readonly SplitCategory[];
  /** The split already set, to edit; null when there is none. */
  readonly current: readonly SplitPart[] | null;
  /** The form's own category, which the first part starts on. */
  readonly firstCategoryId: string | null;
  readonly onApply: (parts: readonly SplitPart[]) => void;
  readonly onClear: () => void;
}) {
  const styles = useStyles();
  const [drafts, setDrafts] = useState<readonly SplitDraft[]>([]);

  useEffect(() => {
    if (!visible) return;
    setDrafts(
      current === null
        ? [
            { categoryId: firstCategoryId, amountText: '' },
            { categoryId: null, amountText: '' },
          ]
        : current.map((part) => ({
            categoryId: part.categoryId,
            amountText: budgetInputText(part.amountMinor, decimals),
          })),
    );
  }, [visible, current, firstCategoryId, decimals]);

  // Nothing to format until the form knows its currency, and nothing to show while the sheet is closed.
  if (!visible || currency === '') return null;

  const result = resolveSplit(totalMinor, drafts, decimals);
  const left = result.remainingMinor;
  const update = (index: number, patch: Partial<SplitDraft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  return (
    <Sheet
      visible={visible}
      title={COPY.split.sheetTitle}
      onClose={onClose}
      testID={SPLIT_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <Text style={styles.total}>{formatMoney(totalMinor, currency)}</Text>
        <Text
          testID={SPLIT_LEFT_TEST_ID}
          style={[styles.left, left < 0 ? styles.over : null]}
          accessibilityLiveRegion="polite"
        >
          {left < 0
            ? COPY.split.over.replace('{amount}', formatMoney(-left, currency))
            : COPY.split.left.replace('{amount}', formatMoney(left, currency))}
        </Text>
        <Text style={styles.hint}>{COPY.split.hint}</Text>

        {drafts.map((draft, index) => (
          <View key={index} style={styles.part}>
            <View style={styles.partHeader}>
              <Text style={styles.partTitle}>
                {COPY.split.part.replace('{n}', String(index + 1))}
              </Text>
              {drafts.length > 2 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${COPY.split.remove} ${index + 1}`}
                  onPress={() => setDrafts((list) => list.filter((_, i) => i !== index))}
                  hitSlop={8}
                >
                  <Text style={styles.removeText}>{COPY.split.remove}</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {categories.map((category) => {
                const selected = draft.categoryId === category.id;
                return (
                  <Pressable
                    key={category.id}
                    testID={`${SPLIT_CATEGORY_TEST_ID_PREFIX}-${index}-${category.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => update(index, { categoryId: category.id })}
                    style={[styles.chip, selected ? styles.chipSelected : null]}
                  >
                    <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                      {category.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextField
              testID={`${SPLIT_AMOUNT_TEST_ID_PREFIX}-${index}`}
              label={COPY.split.amount}
              placeholder={COPY.split.rest}
              value={draft.amountText}
              onChangeText={(next) => update(index, { amountText: next })}
              keyboardType="decimal-pad"
            />
          </View>
        ))}

        <Button
          label={COPY.split.add}
          variant="secondary"
          onPress={() => setDrafts((list) => [...list, { categoryId: null, amountText: '' }])}
          fullWidth
          testID={SPLIT_ADD_TEST_ID}
        />
        <Button
          label={COPY.split.done}
          onPress={() => {
            if (result.status === 'ok') {
              onApply(result.parts);
              onClose();
            }
          }}
          {...(result.status === 'ok' ? {} : { disabledReason: REASONS[result.reason]() })}
          fullWidth
          testID={SPLIT_DONE_TEST_ID}
        />
        {current === null ? null : (
          <Button
            label={COPY.split.clear}
            variant="ghost"
            onPress={() => {
              onClear();
              onClose();
            }}
            fullWidth
            testID={SPLIT_CLEAR_TEST_ID}
          />
        )}
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[3], paddingBottom: space[2] },
    total: { ...type.title1, color: color.text.primary },
    left: { ...type.callout, color: color.primary.default, fontWeight: '600' },
    over: { color: color.danger.default },
    hint: { ...type.footnote, color: color.text.secondary },
    part: {
      gap: space[2],
      padding: space[3],
      borderRadius: radius.lg,
      backgroundColor: color.bg.sunken,
    },
    partHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    partTitle: { ...type.subhead, color: color.text.secondary },
    removeText: { ...type.footnote, color: color.danger.default },
    chips: { gap: space[2] },
    chip: {
      paddingHorizontal: space[3],
      height: 32,
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: color.border.input,
      backgroundColor: color.bg.surface,
    },
    chipSelected: { backgroundColor: color.text.primary, borderColor: color.text.primary },
    chipLabel: { ...type.footnote, color: color.text.secondary },
    chipLabelSelected: { color: color.bg.surface },
  }),
);
