import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { LIMITS } from '@expense-tracker/shared';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { color, radius, space, type } from '../theme/tokens';

/**
 * The note sheet: `docs/design/06-expense-form.md` rule 10.
 *
 * **Hard-capped at 500 characters**, with the 501st keystroke dropped rather than
 * rejected with a message - "the counter already communicates the limit, and an error for
 * a limit the user cannot exceed is noise". The counter turns `warning.default` above 450,
 * which is the warning, so there is nothing left for an error to add.
 *
 * `Done` dismisses the sheet and keeps the text. It does **not** save the expense: the
 * note is one field of a form that has its own Save, and a sheet that committed the whole
 * expense on Done would make the form's Save button a lie.
 *
 * Trimming happens on save rather than here, in `normaliseNote` - a note that is empty
 * after trimming is stored as `null` and not `""`, so the list row renders without a
 * subtitle line instead of with an empty one.
 */

export const NOTE_SHEET_TEST_ID = 'note-sheet';
export const NOTE_INPUT_TEST_ID = 'note-input';
export const NOTE_COUNTER_TEST_ID = 'note-counter';
export const NOTE_DONE_TEST_ID = 'note-done';

/** Above this the counter turns `warning.default` (rule 10). */
const COUNTER_WARNING_AT = 450;

export interface NoteSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly note: string;
  /** Called on Done with the text as typed; trimming is the save path's job. */
  readonly onDone: (note: string) => void;
}

export function NoteSheet({ visible, onClose, note, onDone }: NoteSheetProps) {
  const [draft, setDraft] = useState(note);

  // Re-seeded on each presentation: the sheet stays mounted, so without this a note the
  // user typed and then discarded would come back the next time they opened it.
  useEffect(() => {
    if (visible) setDraft(note);
  }, [visible, note]);

  const remaining = draft.length;

  return (
    <Sheet
      visible={visible}
      title={COPY.form.field.note}
      onClose={onClose}
      testID={NOTE_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextInput
          testID={NOTE_INPUT_TEST_ID}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={COPY.form.field.notePlaceholder}
          placeholderTextColor={color.text.tertiary}
          accessibilityLabel={COPY.form.field.note}
          multiline
          numberOfLines={4}
          autoFocus
          // The cap itself. `maxLength` drops the keystroke, which is what makes the
          // over-limit case unreachable rather than validated.
          maxLength={LIMITS.EXPENSE_NOTE_MAX}
          textAlignVertical="top"
        />

        <Text
          testID={NOTE_COUNTER_TEST_ID}
          style={[styles.counter, remaining > COUNTER_WARNING_AT ? styles.counterWarning : null]}
        >
          {`${remaining}/${LIMITS.EXPENSE_NOTE_MAX}`}
        </Text>

        <Button
          testID={NOTE_DONE_TEST_ID}
          label={COPY.form.noteDone}
          variant="primary"
          fullWidth
          onPress={() => onDone(draft)}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space[3],
    paddingBottom: space[4],
  },
  input: {
    ...type.body,
    color: color.text.primary,
    borderWidth: 1,
    borderColor: color.border.input,
    borderRadius: radius.md,
    padding: space[3],
    // Four lines tall, as a floor - it grows with the font scale rather than clipping.
    minHeight: 4 * 24,
  },
  counter: {
    ...type.footnote,
    color: color.text.tertiary,
    textAlign: 'right',
  },
  counterWarning: {
    color: color.warning.default,
  },
});
