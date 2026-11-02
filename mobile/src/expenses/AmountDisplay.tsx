import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useReduceMotion } from '../lib/useReduceMotion';
import { formatMoney } from '../lib/money';
import { HIT_SLOP_44, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { COPY } from '../copy/strings';

/**
 * The amount, and the one reserved line beneath it:
 * `docs/design/06-expense-form.md` elements 4 and 5.
 *
 * **The display is a `Text`, never a `TextInput`.** That is not a styling choice, it is
 * half of the guarantee in rule 2: a keyboard can never be focused into it, so free text
 * can never reach it, so `0.1.2`, `--5`, `1e9`, `١٢` and the empty string are unreachable
 * inputs rather than cases to validate. The other half is that the value is an integer.
 *
 * Element 5 **reserves its line height even when empty**, so showing an error or a hint
 * never shifts the keypad or the rows below it. A form whose controls move as you type is
 * a form that gets mis-tapped.
 *
 * The helper and the error occupy the same line but are not the same thing: a hint is
 * `text.tertiary` guidance about a form the user has not finished, and an error is
 * `danger.default`. Rule 6 is explicit that the Save hint "is not `danger.default` - this
 * is guidance, not an error".
 */

export const AMOUNT_DISPLAY_TEST_ID = 'amount-display';
export const AMOUNT_MESSAGE_TEST_ID = 'amount-message';

/** Above this font scale the hero drops to `type.display` to keep the keypad on screen. */
const HERO_MAX_FONT_SCALE = 1.4;

export interface AmountDisplayProps {
  readonly amountMinor: number;
  readonly currency: string;
  /** Add mode with an untouched zero renders `text.tertiary`: the zero reads as a placeholder. */
  readonly muted: boolean;
  /** The one genuine amount error - a stored row out of range (rule 8, last row). */
  readonly error?: string;
  /** Why Save is unavailable (rule 6). Guidance, so it is never `danger.default`. */
  readonly hint?: string;
  /** Opens the keypad. Without it the amount is plain text (settle-up, where the keypad is always open). */
  readonly onPress?: () => void;
  /** The keypad is open: a teal line under the amount says it is the field being typed in. */
  readonly focused?: boolean;
}

export function AmountDisplay({
  amountMinor,
  currency,
  muted,
  error,
  hint,
  onPress,
  focused = false,
}: AmountDisplayProps) {
  const styles = useStyles();
  const { fontScale } = useWindowDimensions();
  const formatted = formatMoney(amountMinor, currency);
  const message = error ?? hint;

  // A small pop each time the value changes, so a digit landing is felt as well as read.
  const reduceMotion = useReduceMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const previous = useRef(amountMinor);
  useEffect(() => {
    if (previous.current === amountMinor) return;
    previous.current = amountMinor;
    if (reduceMotion) return;
    pop.setValue(1.06);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 10 }).start();
  }, [amountMinor, reduceMotion, pop]);

  const amountText = (
    <Animated.Text
      testID={AMOUNT_DISPLAY_TEST_ID}
      style={[
        { transform: [{ scale: pop }] },
        fontScale > HERO_MAX_FONT_SCALE ? styles.amountLarge : styles.amountHero,
        muted ? styles.amountMuted : null,
      ]}
      accessibilityRole="header"
      // Announces the running total after every key press - `$1.25`, not `five`. A
      // keypad that announced only the digit pressed would leave a non-sighted user
      // unable to tell what the value is, which is the one thing that matters here
      // (§Accessibility rule 2).
      accessibilityLabel={COPY.a11y.amount.replace('{amount}', formatted)}
      accessibilityLiveRegion="polite"
      // Never truncated: a clipped amount is worse than a taller line.
      numberOfLines={1}
      adjustsFontSizeToFit
    >
      {formatted}
    </Animated.Text>
  );

  return (
    <View style={styles.block}>
      {onPress === undefined ? (
        amountText
      ) : (
        <Pressable
          testID="amount-tap"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityHint={COPY.form.keypad.openHint}
          // The amount is the control that opens the keypad, so it is at least a thumb's width and height.
          hitSlop={HIT_SLOP_44}
          style={[styles.tap, focused ? styles.tapFocused : null]}
        >
          {amountText}
        </Pressable>
      )}

      {/* Always rendered, even with nothing to say, so the line is reserved and the keypad
          below never moves. ` ` rather than `''`: an empty string collapses to zero
          height and takes the reservation with it. */}
      <Text
        testID={AMOUNT_MESSAGE_TEST_ID}
        style={[styles.message, error === undefined ? styles.messageHint : styles.messageError]}
        accessibilityLiveRegion={error === undefined ? 'none' : 'polite'}
      >
        {message ?? ' '}
      </Text>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    block: {
      alignItems: 'center',
      paddingVertical: space[6],
      backgroundColor: color.bg.surface,
    },
    tap: {
      alignItems: 'center',
      paddingHorizontal: space[4],
      paddingBottom: space[1],
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tapFocused: {
      borderBottomColor: color.primary.default,
    },
    amountHero: {
      ...type.amountHero,
      color: color.text.primary,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
    amountLarge: {
      ...type.display,
      color: color.text.primary,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
    amountMuted: {
      color: color.text.tertiary,
    },
    message: {
      ...type.footnote,
      textAlign: 'center',
      marginTop: space[2],
    },
    messageHint: {
      color: color.text.tertiary,
    },
    messageError: {
      color: color.danger.default,
    },
  }),
);
