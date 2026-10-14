import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { HIT_SLOP_44, color, size, space, type } from '../theme/tokens';
import { monthLabel, stepMonth } from '../lib/calendar';
import { SNACK_COPY } from '../copy/strings';
import { useSnackbar } from '../components/Snackbar';
import { useSelectedMonth } from './MonthProvider';

/**
 * The month switcher bar: `docs/design/05-month-switcher.md` §The bar.
 *
 * Pinned below the app bar on both tab screens, identically. It owns no month state - that
 * is {@link useSelectedMonth}, which lives above the tabs so the two screens cannot drift
 * apart (rule 7).
 *
 * Two details that look like polish and are not:
 *
 * - **The arrows are labelled with their destination**, not their direction: `Previous
 *   month, September 2026`. "Previous" alone tells a screen-reader user which way they are
 *   going but not where they land, and the month they land on is the only thing that
 *   changes on screen (§Accessibility rule 2).
 * - **The disabled Next arrow still responds.** A control that is disabled needs a stated
 *   reason (`00-foundations.md` §6), and a 48-tall bar has no room for helper text, so the
 *   reason is delivered on interaction: tapping it shows `This is the current month.`
 *   rather than doing nothing silently (rule 2). It keeps `accessibilityState.disabled`,
 *   so assistive technology still announces it as unavailable.
 */

/**
 * The bar's resting height (§The bar: "48 tall").
 *
 * A local constant rather than a `size` token because it is not one: `tokens.json` carries
 * the sizes that recur across screens, and `tests/theme/tokens.test.ts` asserts the
 * module mirrors that file exactly. Same reasoning as `SwipeToDelete`'s `ACTION_WIDTH`.
 */
const BAR_MIN_HEIGHT = 48;

export const MONTH_SWITCHER_TEST_ID = 'month-switcher';
export const MONTH_PREVIOUS_TEST_ID = 'month-previous';
export const MONTH_NEXT_TEST_ID = 'month-next';
export const MONTH_LABEL_TEST_ID = 'month-label';

export interface MonthSwitcherProps {
  /** Opens the picker sheet (rule 4) - the only path to a non-adjacent month. */
  readonly onOpenPicker: () => void;
}

export function MonthSwitcher({ onOpenPicker }: MonthSwitcherProps) {
  const { month, canGoNext, step } = useSelectedMonth();
  const showSnackbar = useSnackbar();

  const label = monthLabel(month);
  const previousLabel = monthLabel(stepMonth(month, -1));
  const nextLabel = monthLabel(stepMonth(month, 1));

  return (
    <View testID={MONTH_SWITCHER_TEST_ID} style={styles.bar}>
      <Arrow
        testID={MONTH_PREVIOUS_TEST_ID}
        icon="chevron-left"
        // The destination, not the direction (§Accessibility rule 2).
        label={`Previous month, ${previousLabel}`}
        onPress={() => step(-1)}
      />

      <Pressable
        testID={MONTH_LABEL_TEST_ID}
        onPress={onOpenPicker}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Double tap to jump to another month."
        style={styles.label}
      >
        {/* Grows taller rather than truncating: `October 2026` must stay readable at every
            font scale, so there is no `numberOfLines` here (§Accessibility rule 6). */}
        <Text style={styles.labelText}>{label}</Text>
      </Pressable>

      <Arrow
        testID={MONTH_NEXT_TEST_ID}
        icon="chevron-right"
        label={`Next month, ${nextLabel}`}
        disabled={!canGoNext}
        // Not `undefined` when disabled: the tap is what delivers the reason (rule 2).
        onPress={
          canGoNext ? () => step(1) : () => showSnackbar({ message: SNACK_COPY.month.current })
        }
      />
    </View>
  );
}

function Arrow({
  testID,
  icon,
  label,
  onPress,
  disabled = false,
}: {
  readonly testID: string;
  readonly icon: 'chevron-left' | 'chevron-right';
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={HIT_SLOP_44}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Announced as unavailable even though it is still pressable, because what the tap
      // does is explain itself rather than navigate.
      accessibilityState={{ disabled }}
      style={styles.arrow}
    >
      <Feather name={icon} size={20} color={disabled ? color.text.disabled : color.text.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    // A floor, so the bar grows with the label rather than clipping it (rule 6).
    minHeight: BAR_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.bg.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.hairline,
    paddingHorizontal: space[2],
  },
  arrow: {
    minWidth: size.tapTargetMin,
    minHeight: size.tapTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minHeight: size.tapTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    ...type.headline,
    color: color.text.primary,
    textAlign: 'center',
  },
});
