import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { budgetInputText } from '../categories/budgetInput';
import { COPY } from '../copy/strings';
import type { NewGoal } from '../db/mutations';
import type { GoalListItem } from '../db/queries';
import { DateSheet } from '../expenses/DateSheet';
import { dateRowLabel, spokenDate } from '../lib/calendar';
import { currencyDecimals } from '../lib/money';
import { parseDateInput } from '../recurring/recurringModel';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { type GoalDraft, type GoalErrors, validateGoalDraft } from './goalModel';

/**
 * Create and edit a savings goal. One sheet for both, as the recurring and category sheets
 * are. The deadline is picked with the expense form's date sheet, opened with `allowFuture`;
 * while it is open the form sheet steps aside rather than stacking a second modal on it.
 */

export const GOAL_SHEET_TEST_ID = 'goal-sheet';
export const GOAL_NAME_TEST_ID = 'goal-name';
export const GOAL_TARGET_TEST_ID = 'goal-target';
export const GOAL_SAVED_TEST_ID = 'goal-saved';
export const GOAL_DEADLINE_TEST_ID = 'goal-deadline';
export const GOAL_SUBMIT_TEST_ID = 'goal-submit';
export const GOAL_DELETE_TEST_ID = 'goal-delete';

export interface GoalFormSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly editing: GoalListItem | null;
  readonly currency: string;
  readonly today: string;
  readonly onSubmit: (value: Omit<NewGoal, 'currency'>) => Promise<void>;
  readonly onDelete?: () => void;
}

export function GoalFormSheet({
  visible,
  onClose,
  editing,
  currency,
  today,
  onSubmit,
  onDelete,
}: GoalFormSheetProps) {
  const styles = useStyles();
  const decimals = currencyDecimals(currency);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [errors, setErrors] = useState<GoalErrors>({});
  const [picking, setPicking] = useState(false);
  const seeded = useRef(false);

  // Seeded once per presentation: re-seeding an open sheet when a sync lands would reset
  // what the person had typed.
  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      setPicking(false);
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setErrors({});
    setDraft({
      name: editing?.name ?? '',
      targetText: budgetInputText(editing?.targetMinor ?? null, decimals),
      savedText: editing === null ? '' : budgetInputText(editing.savedMinor, decimals),
      deadlineText: editing?.deadline ?? '',
    });
  }, [visible, editing, decimals]);

  const isEdit = editing !== null;

  if (draft === null) {
    return (
      <Sheet
        visible={visible}
        title={COPY.goals.new.title}
        onClose={onClose}
        testID={GOAL_SHEET_TEST_ID}
      >
        <View />
      </Sheet>
    );
  }

  const set = (patch: Partial<GoalDraft>) =>
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  const deadline = parseDateInput(draft.deadlineText);

  const submit = () => {
    const result = validateGoalDraft(draft, decimals);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) void onSubmit(result.value);
  };

  return (
    <>
      <Sheet
        visible={visible && !picking}
        title={isEdit ? COPY.goals.edit.title : COPY.goals.new.title}
        onClose={onClose}
        testID={GOAL_SHEET_TEST_ID}
      >
        <View style={styles.body}>
          <TextField
            testID={GOAL_NAME_TEST_ID}
            label={COPY.goals.field.name}
            value={draft.name}
            onChangeText={(name) => set({ name })}
            error={errors.name}
            maxLength={60}
            autoFocus={!isEdit}
          />

          <TextField
            testID={GOAL_TARGET_TEST_ID}
            label={COPY.goals.field.target}
            value={draft.targetText}
            onChangeText={(targetText) => set({ targetText })}
            error={errors.target}
            keyboardType="decimal-pad"
          />

          {isEdit ? (
            <TextField
              testID={GOAL_SAVED_TEST_ID}
              label={COPY.goals.field.saved}
              value={draft.savedText}
              onChangeText={(savedText) => set({ savedText })}
              error={errors.saved}
              keyboardType="decimal-pad"
            />
          ) : null}

          <View>
            <Row
              testID={GOAL_DEADLINE_TEST_ID}
              onPress={() => setPicking(true)}
              chevron
              lastInGroup
              accessibilityLabel={
                deadline === null
                  ? `${COPY.goals.field.deadline}, ${COPY.goals.field.deadlinePlaceholder}`
                  : `${COPY.goals.field.deadline}, ${dateRowLabel(deadline, today)}, ${spokenDate(deadline)}`
              }
              trailing={
                <Text style={styles.value}>
                  {deadline === null
                    ? COPY.goals.field.deadlinePlaceholder
                    : dateRowLabel(deadline, today)}
                </Text>
              }
            >
              <RowTitle>{COPY.goals.field.deadline}</RowTitle>
            </Row>
            {errors.deadline === undefined ? null : (
              <Text style={styles.error}>{errors.deadline}</Text>
            )}
          </View>

          <Button
            testID={GOAL_SUBMIT_TEST_ID}
            label={isEdit ? COPY.goals.save : COPY.goals.create}
            variant="primary"
            fullWidth
            onPress={submit}
          />

          {onDelete === undefined ? null : (
            <Button
              testID={GOAL_DELETE_TEST_ID}
              label={COPY.goals.delete}
              variant="ghost"
              tone="danger"
              fullWidth
              onPress={onDelete}
            />
          )}
        </View>
      </Sheet>

      <DateSheet
        visible={visible && picking}
        onClose={() => setPicking(false)}
        title={COPY.goals.field.deadline}
        selected={deadline ?? today}
        today={today}
        allowFuture
        quickOptions={false}
        clearOption={{
          label: COPY.goals.field.deadlinePlaceholder,
          onPress: () => {
            set({ deadlineText: '' });
            setPicking(false);
          },
        }}
        onSelect={(date) => {
          set({ deadlineText: date });
          setPicking(false);
        }}
      />
    </>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[5], paddingBottom: space[4] },
    error: { ...type.callout, color: color.danger.default, marginTop: space[1] },
    value: { ...type.body, color: color.text.secondary },
  }),
);
