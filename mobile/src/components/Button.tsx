import {
  ActivityIndicator,
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { color, isDark, radius, size, space, type } from '../theme/tokens';

/**
 * The button, as `docs/design/00-foundations.md` §6 specifies it.
 *
 * Two of that section's rules are enforced by the *shape of the props* rather than by a
 * reviewer noticing:
 *
 * - **"A disabled primary button with no stated reason is a spec violation."** So there
 *   is no `disabled` prop. Disabling happens by passing {@link ButtonProps.disabledReason},
 *   and that string is rendered as helper text below the button. A caller cannot disable a
 *   button without saying why, because there is no API for it.
 * - **Busy holds the button's width** so it does not resize mid-request. The label stays
 *   mounted at zero opacity and the indicator is overlaid on top of it, which is the only
 *   way to hold the exact width of the label rather than an approximation of it.
 *
 * Busy is used for exactly two actions in the app - Sign up and Log in - because they are
 * the only two that wait on the network (`docs/design/03-auth.md`).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: (event: GestureResponderEvent) => void;
  readonly variant?: ButtonVariant;
  /**
   * Recolour a `ghost` button's label to `danger.default`.
   *
   * Two screen specs ask for exactly this pairing - a full-width ghost button whose label
   * is destructive rather than primary: `Delete expense`
   * (`docs/design/06-expense-form.md` element 9) and `Delete category`
   * (`07-categories.md` §3). Neither is a `destructive` button, which is a filled red
   * `danger.default` block; these sit at the bottom of a form as the quiet way out, and a
   * filled red block there would compete with Save.
   *
   * It is a tone rather than a fifth variant because `00-foundations.md` §6 names four,
   * and the only thing that changes is the label colour.
   */
  readonly tone?: 'default' | 'danger';
  /** Full width when this is a screen's main action (§6). */
  readonly fullWidth?: boolean;
  /**
   * In flight. The label is replaced by an indicator, taps are ignored, and the
   * accessibility label gains `, in progress`.
   */
  readonly busy?: boolean;
  /**
   * Why this button cannot be used, or undefined when it can be.
   *
   * Passing it disables the button *and* renders it as helper text below. There is
   * deliberately no way to do one without the other.
   */
  readonly disabledReason?: string;
  readonly testID?: string;
}

interface VariantStyle {
  readonly fill: string;
  readonly pressedFill: string;
  readonly label: string;
  readonly borderColor?: string;
  readonly minHeight: number;
}

const VARIANTS: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: {
    fill: color.primary.default,
    pressedFill: color.primary.pressed,
    label: color.text.inverse,
    minHeight: size.buttonHeight,
  },
  secondary: {
    fill: color.bg.surface,
    // Pressed `secondary` and `ghost` both take a `primary.subtle` fill (§6).
    pressedFill: color.primary.subtle,
    label: color.primary.default,
    borderColor: color.border.input,
    minHeight: size.buttonHeight,
  },
  ghost: {
    fill: 'transparent',
    pressedFill: color.primary.subtle,
    label: color.primary.default,
    // 44 rather than 48: a ghost button is the one variant specified at the tap-target
    // floor instead of the button height.
    minHeight: size.tapTargetMin,
  },
  destructive: {
    fill: color.danger.default,
    // "darkens equivalently" to primary's pressed step. There is no `danger.pressed`
    // token, so the shift is the same relative darkening applied to `danger.default`.
    pressedFill: isDark ? '#D9645C' : '#8E1E17',
    label: color.text.inverse,
    minHeight: size.buttonHeight,
  },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  tone = 'default',
  fullWidth = false,
  busy = false,
  disabledReason,
  testID,
}: ButtonProps) {
  const base = VARIANTS[variant];
  // Only the label moves. The fill, the pressed fill and the height stay the variant's,
  // so a danger-toned ghost is still a ghost.
  const palette = tone === 'danger' ? { ...base, label: color.danger.default } : base;
  const disabled = disabledReason !== undefined;
  // Busy ignores taps without reading as disabled: the request is in flight, which is not
  // the same thing as the action being unavailable, and it must not take the grey fill.
  const inert = disabled || busy;

  return (
    <View style={fullWidth ? styles.fullWidth : undefined}>
      <Pressable
        testID={testID}
        onPress={inert ? undefined : onPress}
        accessibilityRole="button"
        accessibilityLabel={busy ? `${label}, in progress` : label}
        accessibilityState={{ disabled, busy }}
        // A disabled control is still readable by a screen reader - it has to be, or the
        // stated reason below it has nothing to attach to.
        accessibilityHint={disabledReason}
        style={({ pressed }) => [
          styles.button,
          {
            minHeight: palette.minHeight,
            backgroundColor: disabled
              ? color.bg.sunken
              : pressed && !busy
                ? palette.pressedFill
                : palette.fill,
          },
          // Disabled drops the border along with the fill (§6).
          palette.borderColor !== undefined && !disabled
            ? { borderWidth: 1, borderColor: palette.borderColor }
            : null,
        ]}
      >
        <Text
          style={[
            styles.label,
            { color: disabled ? color.text.disabled : palette.label },
            // Held, not unmounted: this is what keeps the width from jumping when the
            // label is swapped for a 20px indicator.
            busy ? styles.labelHidden : null,
          ]}
          // The Pressable above carries the accessible name, so the label must not be
          // read a second time - and while busy it is not the current state anyway.
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {label}
        </Text>
        {busy ? (
          <View style={styles.indicator} pointerEvents="none">
            <ActivityIndicator size="small" color={palette.label} />
          </View>
        ) : null}
      </Pressable>
      {disabledReason === undefined ? null : <Text style={styles.reason}>{disabledReason}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidth: {
    alignSelf: 'stretch',
  },
  button: {
    // `minHeight`, not `height`: the heights in §6 are floors that grow with font scale.
    borderRadius: radius.md,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...type.bodyStrong,
    textAlign: 'center',
  },
  labelHidden: {
    opacity: 0,
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reason: {
    ...type.footnote,
    color: color.text.tertiary,
    marginTop: space[1],
  },
});
