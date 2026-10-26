import { type ReactNode, type Ref, useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { color, isDark, radius, size, space, type } from '../theme/tokens';

/**
 * The text field, as `docs/design/00-foundations.md` §6 specifies it.
 *
 * ```
 * Label                                    <- type.subhead, text.secondary
 * +--------------------------------------+
 * | Value or placeholder                 |  <- 48 tall, radius.md, 1px border.input
 * +--------------------------------------+
 * Helper or error text                     <- type.footnote
 * ```
 *
 * Two details are less obvious than they look:
 *
 * - **The focus ring is an overlay, not a thicker border.** §6 says the 2px
 *   `border.focus` is "drawn inset so the field does not shift". Swapping `borderWidth`
 *   from 1 to 2 on focus moves the text one pixel and reflows everything below it on
 *   every tap, so the resting 1px border stays put and a second, absolutely positioned
 *   view is drawn over it.
 * - **The error *replaces* the helper text; the two never stack.** Which is why there is
 *   one slot below the field rather than two, and why it is the slot that decides its own
 *   colour. A field that grew by a line when it went invalid would push the submit button
 *   down as the user fixed it.
 *
 * Validation *timing* is not this component's business - it renders whatever `error` it
 * is given. The rule about never showing an error for a field the user has not yet left
 * lives in `src/auth/formState.ts`, where it can be tested without rendering anything.
 */

export interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  /** Resting helper text. Replaced by {@link error} when there is one. */
  readonly helper?: string;
  /** The field is in its error state when this is set. */
  readonly error?: string;
  /** Rendered inside the field, trailing - the password reveal toggle. */
  readonly trailing?: ReactNode;
  readonly inputRef?: Ref<TextInput>;
  readonly placeholder?: string;
  readonly onBlur?: () => void;
  readonly testID?: string;
  /**
   * Passed straight through. Listed explicitly rather than spreading
   * `TextInputProps`, so that what the auth screens set - keyboard type, autofill
   * hints, return key behaviour - is visible at this boundary instead of arriving as an
   * untyped bag.
   */
  readonly keyboardType?: TextInputProps['keyboardType'];
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly autoComplete?: TextInputProps['autoComplete'];
  readonly textContentType?: TextInputProps['textContentType'];
  readonly autoCorrect?: boolean;
  readonly autoFocus?: boolean;
  readonly secureTextEntry?: boolean;
  readonly returnKeyType?: TextInputProps['returnKeyType'];
  readonly onSubmitEditing?: () => void;
  readonly editable?: boolean;
  /**
   * Hard cap on the input's length.
   *
   * Used where a limit is enforced by refusing the keystroke rather than by showing an
   * error - the category name's 64 and the note's 500. Both specs make the same point:
   * "no error is needed for a limit that cannot be exceeded"
   * (`docs/design/07-categories.md` §2 rule 3, `06-expense-form.md` rule 10).
   */
  readonly maxLength?: number;
  readonly submitBehavior?: TextInputProps['submitBehavior'];
}

export function TextField({
  label,
  value,
  onChangeText,
  helper,
  error,
  trailing,
  inputRef,
  placeholder,
  onBlur,
  testID,
  ...inputProps
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const invalid = error !== undefined;

  return (
    <View>
      <Text style={styles.label} nativeID={`${label}-label`}>
        {label}
      </Text>

      <View
        style={[styles.field, { borderColor: invalid ? color.danger.default : color.border.input }]}
      >
        <TextInput
          ref={inputRef}
          testID={testID}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={color.text.tertiary}
          keyboardAppearance={isDark ? 'dark' : 'light'}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          // §6: the error text goes *into* the field's accessible name, because a screen
          // reader user who lands on the input must hear why it is wrong without having
          // to go hunting for the helper slot below it.
          accessibilityLabel={invalid ? `${label}, invalid: ${error}` : label}
          accessibilityHint={invalid ? undefined : helper}
          accessibilityState={{ disabled: inputProps.editable === false }}
          {...inputProps}
        />
        {trailing}
        {/* The focus ring. Drawn over the resting border so focusing shifts nothing. */}
        {focused ? (
          <View
            testID={testID === undefined ? undefined : `${testID}-focus-ring`}
            style={styles.focusRing}
            pointerEvents="none"
          />
        ) : null}
      </View>

      {/* One slot, never two: the error replaces the helper rather than stacking under
          it, so the field does not grow by a line when it goes invalid. */}
      {invalid || helper !== undefined ? (
        <Text style={[styles.helper, invalid ? styles.helperError : null]}>
          {invalid ? error : helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...type.subhead,
    color: color.text.secondary,
    marginBottom: space[2],
  },
  field: {
    // A floor, so the field grows with font scale rather than clipping (§2).
    minHeight: size.inputHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: color.bg.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[3],
  },
  input: {
    ...type.body,
    color: color.text.primary,
    flex: 1,
    // Vertical padding rather than a fixed height, for the same font-scale reason.
    paddingVertical: space[3],
  },
  focusRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: color.border.focus,
    borderRadius: radius.md,
  },
  helper: {
    ...type.footnote,
    color: color.text.tertiary,
    marginTop: space[1],
  },
  helperError: {
    color: color.danger.default,
  },
});
