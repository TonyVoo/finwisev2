import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Row, RowTitle, Swatch } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { budgetInputText } from '../categories/budgetInput';
import { DateSheet } from '../expenses/DateSheet';
import { COPY } from '../copy/strings';
import type { CategoryListItem, RecurringListItem } from '../db/queries';
import { dateRowLabel, spokenDate } from '../lib/calendar';
import { currencyDecimals } from '../lib/money';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import {
  type RecurringDraft,
  type RecurringErrors,
  parseDateInput,
  validateRecurringDraft,
} from './recurringModel';
import type { NewRecurring } from '../db/mutations';

/**
 * Create and edit a recurring expense. One sheet for both, as the category sheet is.
 *
 * Start and end are picked with the expense form's date sheet, opened with `allowFuture`:
 * a rule very often starts in the *future* ("from the 1st"). While a date is being picked the
 * form sheet steps aside and the date sheet takes its place, rather than stacking a second
 * modal on the first, which iOS handles badly. The draft lives here, so nothing typed is lost.
 */

export const RECURRING_SHEET_TEST_ID = 'recurring-sheet';
export const RECURRING_AMOUNT_TEST_ID = 'recurring-amount';
export const RECURRING_NOTE_TEST_ID = 'recurring-note';
export const RECURRING_START_TEST_ID = 'recurring-start';
export const RECURRING_END_TEST_ID = 'recurring-end';
export const RECURRING_SUBMIT_TEST_ID = 'recurring-submit';
export const RECURRING_DELETE_TEST_ID = 'recurring-delete';
export const RECURRING_FREQUENCY_TEST_ID_PREFIX = 'recurring-frequency';
export const RECURRING_CATEGORY_TEST_ID_PREFIX = 'recurring-category';

export interface RecurringFormSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly editing: RecurringListItem | null;
  readonly categories: readonly CategoryListItem[];
  readonly currency: string;
  /** Today as a `YYYY-MM-DD`, from the same clock as everything else on screen. */
  readonly today: string;
  readonly onSubmit: (value: Omit<NewRecurring, 'currency'>) => Promise<void>;
  readonly onDelete?: () => void;
}

const FREQUENCIES = ['weekly', 'monthly'] as const;

export function RecurringFormSheet({
  visible,
  onClose,
  editing,
  categories,
  currency,
  today,
  onSubmit,
  onDelete,
}: RecurringFormSheetProps) {
  const styles = useStyles();
  const decimals = currencyDecimals(currency);
  const [draft, setDraft] = useState<RecurringDraft | null>(null);
  const [errors, setErrors] = useState<RecurringErrors>({});
  const seeded = useRef(false);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  // Seeded once per presentation, for the reason the category sheet gives: re-seeding an
  // open sheet when a category arrives by sync would reset what the person had typed.
  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      setPicking(null);
      return;
    }
    if (seeded.current) return;
    seeded.current = true;

    setErrors({});
    setDraft({
      categoryId: editing?.categoryId ?? categories[0]?.id ?? null,
      amountText: budgetInputText(editing?.amountMinor ?? null, decimals),
      note: editing?.note ?? '',
      frequency: editing?.frequency ?? 'monthly',
      startText: editing?.startDate ?? today,
      endText: editing?.endDate ?? '',
    });
  }, [visible, editing, categories, decimals, today]);

  if (draft === null) {
    return (
      <Sheet
        visible={visible}
        title={COPY.recurring.new.title}
        onClose={onClose}
        testID={RECURRING_SHEET_TEST_ID}
      >
        <View />
      </Sheet>
    );
  }

  const set = (patch: Partial<RecurringDraft>) =>
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  const isEdit = editing !== null;
  const inPast = /^\d{4}-\d{2}-\d{2}$/.test(draft.startText) && draft.startText < today;

  const submit = () => {
    const result = validateRecurringDraft(draft, decimals);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) void onSubmit(result.value);
  };

  const start = parseDateInput(draft.startText) ?? today;
  const end = parseDateInput(draft.endText);

  return (
    <>
      <Sheet
        visible={visible && picking === null}
        title={isEdit ? COPY.recurring.edit.title : COPY.recurring.new.title}
        onClose={onClose}
        testID={RECURRING_SHEET_TEST_ID}
      >
        <View style={styles.body}>
          <TextField
            testID={RECURRING_AMOUNT_TEST_ID}
            label={COPY.recurring.field.amount}
            value={draft.amountText}
            onChangeText={(amountText) => set({ amountText })}
            error={errors.amount}
            keyboardType="decimal-pad"
            autoFocus={!isEdit}
          />

          <View>
            <Text style={styles.label}>{COPY.recurring.field.category}</Text>
            {categories.length === 0 ? (
              <Text style={styles.error}>{COPY.recurring.error.noCategory}</Text>
            ) : (
              categories.map((category, index) => (
                <Row
                  key={category.id}
                  testID={`${RECURRING_CATEGORY_TEST_ID_PREFIX}-${category.id}`}
                  onPress={() => set({ categoryId: category.id })}
                  lastInGroup={index === categories.length - 1}
                  leading={<Swatch colorHex={category.color} name={category.name} />}
                  accessibilityLabel={category.name}
                  accessibilityState={{ selected: category.id === draft.categoryId }}
                  trailing={
                    category.id === draft.categoryId ? (
                      <Text style={styles.check} accessibilityElementsHidden>
                        ✓
                      </Text>
                    ) : null
                  }
                >
                  <RowTitle>{category.name}</RowTitle>
                </Row>
              ))
            )}
            {errors.category === undefined ? null : (
              <Text style={styles.error}>{errors.category}</Text>
            )}
          </View>

          <View>
            <Text style={styles.label}>{COPY.recurring.field.frequency}</Text>
            <View style={styles.segments} accessibilityRole="radiogroup">
              {FREQUENCIES.map((frequency) => {
                const selected = draft.frequency === frequency;
                return (
                  <Pressable
                    key={frequency}
                    testID={`${RECURRING_FREQUENCY_TEST_ID_PREFIX}-${frequency}`}
                    onPress={() => set({ frequency })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={COPY.recurring.frequency[frequency]}
                    style={[styles.segment, selected ? styles.segmentSelected : null]}
                  >
                    <Text
                      style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}
                    >
                      {COPY.recurring.frequency[frequency]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View>
            <Row
              testID={RECURRING_START_TEST_ID}
              onPress={() => setPicking('start')}
              chevron
              lastInGroup
              accessibilityLabel={`${COPY.recurring.field.startDate}, ${dateRowLabel(start, today)}, ${spokenDate(start)}`}
              trailing={<Text style={styles.value}>{dateRowLabel(start, today)}</Text>}
            >
              <RowTitle>{COPY.recurring.field.startDate}</RowTitle>
            </Row>
            {errors.startDate === undefined ? null : (
              <Text style={styles.error}>{errors.startDate}</Text>
            )}
          </View>
          {inPast && !isEdit ? (
            <Text style={styles.hint}>{COPY.recurring.hint.pastStart}</Text>
          ) : null}

          <View>
            <Row
              testID={RECURRING_END_TEST_ID}
              onPress={() => setPicking('end')}
              chevron
              lastInGroup
              accessibilityLabel={
                end === null
                  ? `${COPY.recurring.field.endDate}, ${COPY.recurring.field.endPlaceholder}`
                  : `${COPY.recurring.field.endDate}, ${dateRowLabel(end, today)}, ${spokenDate(end)}`
              }
              trailing={
                <Text style={styles.value}>
                  {end === null ? COPY.recurring.field.endPlaceholder : dateRowLabel(end, today)}
                </Text>
              }
            >
              <RowTitle>{COPY.recurring.field.endDate}</RowTitle>
            </Row>
            {errors.endDate === undefined ? null : (
              <Text style={styles.error}>{errors.endDate}</Text>
            )}
          </View>

          <TextField
            testID={RECURRING_NOTE_TEST_ID}
            label={COPY.recurring.field.note}
            value={draft.note}
            onChangeText={(note) => set({ note })}
            maxLength={500}
            returnKeyType="done"
          />

          <Button
            testID={RECURRING_SUBMIT_TEST_ID}
            label={isEdit ? COPY.recurring.save : COPY.recurring.create}
            variant="primary"
            fullWidth
            onPress={submit}
          />

          {onDelete === undefined ? null : (
            <Button
              testID={RECURRING_DELETE_TEST_ID}
              label={COPY.recurring.delete}
              variant="ghost"
              tone="danger"
              fullWidth
              onPress={onDelete}
            />
          )}
        </View>
      </Sheet>

      <DateSheet
        visible={visible && picking !== null}
        onClose={() => setPicking(null)}
        title={picking === 'end' ? COPY.recurring.field.endDate : COPY.recurring.field.startDate}
        selected={picking === 'end' ? (end ?? start) : start}
        today={today}
        allowFuture
        minimum={picking === 'end' ? start : undefined}
        quickOptions={picking !== 'end'}
        clearOption={
          picking === 'end'
            ? {
                label: COPY.recurring.field.endPlaceholder,
                onPress: () => {
                  set({ endText: '' });
                  setPicking(null);
                },
              }
            : undefined
        }
        onSelect={(date) => {
          set(picking === 'end' ? { endText: date } : { startText: date });
          setPicking(null);
        }}
      />
    </>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[5], paddingBottom: space[4] },
    label: { ...type.callout, color: color.text.secondary, marginBottom: space[2] },
    hint: { ...type.callout, color: color.text.tertiary, marginTop: -space[3] },
    error: { ...type.callout, color: color.danger.default, marginTop: space[1] },
    value: { ...type.body, color: color.text.secondary },
    check: { ...type.bodyStrong, color: color.primary.default },
    segments: { flexDirection: 'row', gap: space[2] },
    segment: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border.hairline,
      backgroundColor: color.bg.surface,
    },
    segmentSelected: { backgroundColor: color.primary.subtle, borderColor: color.primary.default },
    segmentText: { ...type.body, color: color.text.primary },
    segmentTextSelected: { color: color.primary.pressed, fontWeight: '600' },
  }),
);
