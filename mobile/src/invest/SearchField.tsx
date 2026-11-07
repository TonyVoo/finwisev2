import Feather from '@expo/vector-icons/Feather';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COPY } from '../copy/strings';
import { HIT_SLOP_44, radius, size, space, type } from '../theme/tokens';
import { createStyles, useColors, useTheme } from '../theme/ThemeProvider';

/**
 * The symbol search: a rounded field with a magnifier, a clear button once there is text, and a round
 * go button on the right that spins while the lookup runs. One control instead of a field and a full-width
 * button stacked under it, so the whole lookup is one line of the screen.
 */

export const SEARCH_FIELD_TEST_ID = 'invest-symbol';
export const SEARCH_GO_TEST_ID = 'invest-lookup';
export const SEARCH_CLEAR_TEST_ID = 'invest-clear';

export function SearchField({
  value,
  onChangeText,
  onSubmit,
  busy,
  disabled,
  disabledReason,
}: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly onSubmit: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
  /** Said under the field when the lookup cannot run (offline). */
  readonly disabledReason?: string;
}) {
  const styles = useStyles();
  const color = useColors();
  const { isDark } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, focused ? styles.focused : null]}>
        <Feather name="search" size={18} color={color.text.tertiary} />
        <TextInput
          ref={input}
          testID={SEARCH_FIELD_TEST_ID}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={COPY.invest.searchPlaceholder}
          placeholderTextColor={color.text.tertiary}
          keyboardAppearance={isDark ? 'dark' : 'light'}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          maxLength={10}
          returnKeyType="search"
          onSubmitEditing={disabled === true ? undefined : onSubmit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={COPY.invest.symbolLabel}
        />
        {value === '' ? null : (
          <Pressable
            testID={SEARCH_CLEAR_TEST_ID}
            onPress={() => {
              onChangeText('');
              input.current?.focus();
            }}
            hitSlop={HIT_SLOP_44}
            accessibilityRole="button"
            accessibilityLabel={COPY.invest.clear}
          >
            <Feather name="x-circle" size={18} color={color.text.tertiary} />
          </Pressable>
        )}
        <Pressable
          testID={SEARCH_GO_TEST_ID}
          onPress={onSubmit}
          disabled={disabled || busy}
          accessibilityRole="button"
          accessibilityLabel={COPY.invest.lookup}
          accessibilityState={{ busy, disabled: disabled === true }}
          style={({ pressed }) => [
            styles.go,
            disabled === true ? styles.goDisabled : null,
            pressed ? { backgroundColor: color.primary.pressed } : null,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={color.text.inverse} />
          ) : (
            <Feather name="arrow-right" size={18} color={color.text.inverse} />
          )}
        </Pressable>
      </View>
      {disabledReason === undefined ? null : (
        <View style={styles.reasonRow}>
          <Feather name="wifi-off" size={13} color={color.text.tertiary} />
          <TextReason text={disabledReason} />
        </View>
      )}
    </View>
  );
}

function TextReason({ text }: { readonly text: string }) {
  const styles = useStyles();
  return <Text style={styles.reason}>{text}</Text>;
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { gap: space[2] },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      height: size.inputHeight + 4,
      paddingLeft: space[4],
      paddingRight: space[2],
      borderRadius: radius.pill,
      backgroundColor: color.bg.surface,
      borderWidth: 1.5,
      borderColor: color.border.hairline,
    },
    focused: { borderColor: color.border.focus },
    input: {
      flex: 1,
      ...type.body,
      color: color.text.primary,
      paddingVertical: 0,
      letterSpacing: 0.4,
    },
    go: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.primary.default,
    },
    goDisabled: { opacity: 0.4 },
    reasonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      paddingHorizontal: space[2],
    },
    reason: { ...type.footnote, color: color.text.tertiary },
  }),
);
