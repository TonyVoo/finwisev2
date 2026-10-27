import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useEffect, useRef } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY } from '../copy/strings';
import { motion, radius, size, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

/**
 * The amount keypad: `docs/design/06-expense-form.md` elements 10-13.
 *
 * **Pinned to the bottom and always visible.** It is not a system keyboard and it never
 * dismisses, which is what makes "add an amount and a category, save" three taps and a few
 * digits - no field has to be focused first.
 *
 * The decimal key is **hidden entirely for a zero-decimal currency** rather than disabled,
 * and the `0` key expands to fill its cell so the grid stays 4x3 with no hole (rule 3).
 * "A decimal key on a currency without a minor unit is a control that can only confuse" -
 * and a disabled one would owe the user a reason there is no room to give.
 *
 * Keys are laid out in the standard phone-dial arrangement so muscle memory transfers, and
 * each is at least 56x56 - comfortably past the 44 floor, because this is the one control
 * on the screen the user hits repeatedly.
 */

export const KEYPAD_TEST_ID = 'keypad';
export const KEYPAD_DECIMAL_TEST_ID = 'keypad-decimal';
export const KEYPAD_BACKSPACE_TEST_ID = 'keypad-backspace';

export interface KeypadProps {
  readonly onDigit: (digit: number) => void;
  readonly onDecimal: () => void;
  readonly onBackspace: () => void;
  /** The user's currency decimals. `0` hides the decimal key (rule 3). */
  readonly decimals: number;
  /**
   * Bumped by the screen each time a press was ignored for being over the maximum, which
   * shakes the grid once (rule 5). Suppressed under Reduce Motion by the screen, which is
   * what owns that preference.
   */
  readonly rejectionCount?: number;
  readonly shakeEnabled?: boolean;
}

export function Keypad({
  onDigit,
  onDecimal,
  onBackspace,
  decimals,
  rejectionCount = 0,
  shakeEnabled = true,
}: KeypadProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const shake = useRef(new Animated.Value(0)).current;
  const previousRejections = useRef(rejectionCount);

  useEffect(() => {
    if (rejectionCount === previousRejections.current) return;
    previousRejections.current = rejectionCount;
    if (!shakeEnabled) return;

    // One `motion.fast` shake, there and back. Reduce Motion suppresses it entirely and
    // the snackbar alone carries the message (§Accessibility rule 8).
    Animated.sequence([
      Animated.timing(shake, {
        toValue: 1,
        duration: motion.fast.duration / 2,
        useNativeDriver: true,
      }),
      Animated.timing(shake, {
        toValue: 0,
        duration: motion.fast.duration / 2,
        useNativeDriver: true,
      }),
    ]).start();
  }, [rejectionCount, shakeEnabled, shake]);

  const translateX = shake.interpolate({ inputRange: [0, 1], outputRange: [0, 8] });

  return (
    <Animated.View
      testID={KEYPAD_TEST_ID}
      // The backdrop itself carries no meaning; the keys below are each a button.
      style={[
        styles.backdrop,
        { paddingBottom: insets.bottom + space[2], transform: [{ translateX }] },
      ]}
    >
      <View style={styles.row}>
        <DigitKey digit={1} onPress={onDigit} />
        <DigitKey digit={2} onPress={onDigit} />
        <DigitKey digit={3} onPress={onDigit} />
      </View>
      <View style={styles.row}>
        <DigitKey digit={4} onPress={onDigit} />
        <DigitKey digit={5} onPress={onDigit} />
        <DigitKey digit={6} onPress={onDigit} />
      </View>
      <View style={styles.row}>
        <DigitKey digit={7} onPress={onDigit} />
        <DigitKey digit={8} onPress={onDigit} />
        <DigitKey digit={9} onPress={onDigit} />
      </View>
      <View style={styles.row}>
        {decimals > 0 ? (
          <Key
            testID={KEYPAD_DECIMAL_TEST_ID}
            label={decimalSeparator()}
            accessibilityLabel={COPY.form.keypad.decimal}
            onPress={onDecimal}
          />
        ) : null}
        {/* `flex: 1` on every cell means the `0` key takes the decimal key's space when it
            is hidden, with no gap left behind. */}
        <DigitKey digit={0} onPress={onDigit} />
        <Key
          testID={KEYPAD_BACKSPACE_TEST_ID}
          accessibilityLabel={COPY.form.keypad.backspace}
          onPress={onBackspace}
          glyph="delete"
        />
      </View>
    </Animated.View>
  );
}

/**
 * The device's decimal separator - `.` or `,` (element 12).
 *
 * Asked of `Intl` rather than hardcoded, because the key has to show what the user's
 * locale writes. It is **only** a label: the separator never enters the value, which is an
 * integer (rule 2), so getting this wrong could only ever mislabel a key.
 */
function decimalSeparator(): string {
  const parts = new Intl.NumberFormat(undefined).formatToParts(1.1);
  return parts.find((part) => part.type === 'decimal')?.value ?? '.';
}

function DigitKey({
  digit,
  onPress,
}: {
  readonly digit: number;
  readonly onPress: (digit: number) => void;
}) {
  return (
    <Key
      testID={`keypad-${digit}`}
      label={String(digit)}
      accessibilityLabel={String(digit)}
      onPress={() => onPress(digit)}
    />
  );
}

function Key({
  testID,
  label,
  accessibilityLabel,
  glyph,
  onPress,
}: {
  readonly testID: string;
  readonly label?: string;
  readonly accessibilityLabel: string;
  readonly glyph?: keyof typeof Feather.glyphMap;
  readonly onPress: () => void;
}) {
  const color = useColors();
  const styles = useStyles();
  // The key's height floor grows with the OS font scale, so a large-text user gets a
  // taller keypad rather than clipped labels (§Accessibility rule 5).
  const { fontScale } = useWindowDimensions();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.key,
        { minHeight: size.rowMinHeight * Math.max(1, fontScale) },
        { backgroundColor: pressed ? color.bg.canvas : color.bg.surface },
      ]}
    >
      {glyph === undefined ? (
        <Text style={styles.keyLabel} numberOfLines={1}>
          {label}
        </Text>
      ) : (
        <Feather name={glyph} size={24} color={color.text.primary} />
      )}
    </Pressable>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    backdrop: {
      backgroundColor: color.bg.sunken,
      paddingHorizontal: space[2],
      paddingTop: space[2],
      gap: space[2],
    },
    row: {
      flexDirection: 'row',
      gap: space[2],
    },
    key: {
      flex: 1,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyLabel: {
      ...type.title2,
      color: color.text.primary,
    },
  }),
);
