import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { singleLineInput } from '../theme/inputText';
import { radius, size, space, type } from '../theme/tokens';
import { createStyles, useColors, useTheme } from '../theme/ThemeProvider';

export const QUICK_ADD_INPUT_TEST_ID = 'quick-add-input';
export const QUICK_ADD_FILL_TEST_ID = 'quick-add-fill';
/** The suggestion card and its two buttons are `<this>`, `<this>-use` and `<this>-dismiss`. */
export const QUICK_ADD_SUGGESTION_TEST_ID = 'quick-add-suggestion';
export const QUICK_ADD_SUGGESTION_USE_TEST_ID = `${QUICK_ADD_SUGGESTION_TEST_ID}-use`;
export const QUICK_ADD_SUGGESTION_DISMISS_TEST_ID = `${QUICK_ADD_SUGGESTION_TEST_ID}-dismiss`;

/**
 * The "Describe it" line at the top of Add expense (`docs/design/15-quick-add.md`): type a sentence,
 * tap Fill, and the form offers what it understood. Stateless: the form owns the text, and reading it is
 * the form's business, so this is only the field, the button and the line that says where the reading
 * happens.
 */
export function QuickAddLine({
  value,
  onChangeText,
  onFill,
  busy,
  hint,
}: {
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly onFill: () => void;
  /** The server is being asked about the sentence: Fill shows progress and ignores presses. */
  readonly busy: boolean;
  /** Where the sentence is read: on the phone only, or possibly by an outside service. */
  readonly hint: string;
}) {
  const styles = useStyles();
  const color = useColors();
  const { isDark } = useTheme();
  // Where the sentence is read is worth a line - but only once someone is about to use it, not above every form.
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          testID={QUICK_ADD_INPUT_TEST_ID}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={COPY.form.quickAdd.placeholder}
          placeholderTextColor={color.text.tertiary}
          keyboardAppearance={isDark ? 'dark' : 'light'}
          accessibilityLabel={COPY.form.quickAdd.label}
          returnKeyType="done"
          onSubmitEditing={onFill}
          maxLength={300}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <Button
          label={COPY.form.quickAdd.fill}
          onPress={onFill}
          variant="secondary"
          busy={busy}
          testID={QUICK_ADD_FILL_TEST_ID}
        />
      </View>
      {focused || value !== '' ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { marginHorizontal: space[4], marginTop: space[2], gap: space[1] },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    input: {
      ...singleLineInput,
      flex: 1,
      // A fixed height with no vertical padding: a single line of text is centred in it.
      height: size.inputHeight,
      paddingHorizontal: space[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border.input,
      backgroundColor: color.bg.surface,
      color: color.text.primary,
    },
    hint: { ...type.footnote, color: color.text.tertiary },
  }),
);
