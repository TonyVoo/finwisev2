import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { SkeletonBlock } from '../components/Chrome';
import { Button } from '../components/Button';
import { EMPTY_COPY, emptyMonthHeadline, goToMonthAction } from '../copy/strings';
import { color, size, space, type } from '../theme/tokens';

/**
 * Home's non-default list states: `docs/design/04-expense-list.md` §States.
 *
 * The two empty states are deliberately not one parameterised state, because they are
 * addressed to different people. A user with no expenses at all is being told what the app
 * is for, so they get an illustration, an explanation and a primary button. A user looking
 * at a month they happened not to spend in already knows what the app is for; the spec is
 * explicit that they get "no illustration, no primary button", because "the useful action
 * is navigation, not creation".
 *
 * Collapsing them would mean showing a first-run tutorial to someone scrolling back through
 * their own history.
 */

export const FIRST_RUN_EMPTY_TEST_ID = 'empty-first-run';
export const MONTH_EMPTY_TEST_ID = 'empty-month';
export const LIST_SKELETON_TEST_ID = 'list-skeleton';
export const EMPTY_ILLUSTRATION_TEST_ID = 'empty-illustration';

/** State `empty` - first run: no expenses anywhere in the database. */
export function FirstRunEmpty({ onAddFirst }: { readonly onAddFirst: () => void }) {
  return (
    <View testID={FIRST_RUN_EMPTY_TEST_ID} style={styles.empty}>
      <Feather
        testID={EMPTY_ILLUSTRATION_TEST_ID}
        name="pie-chart"
        size={48}
        color={color.text.tertiary}
        // §Accessibility rule 7: the illustration is hidden and the headline carries the
        // meaning, so a screen reader hears the sentence rather than "image".
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.headline} accessibilityRole="header">
        {EMPTY_COPY.home.firstRun.headline}
      </Text>
      <Text style={styles.body}>{EMPTY_COPY.home.firstRun.body}</Text>
      <Button
        label={EMPTY_COPY.home.firstRun.action}
        variant="primary"
        onPress={onAddFirst}
        testID="empty-add-first"
      />
    </View>
  );
}

export interface MonthEmptyProps {
  /** The selected month, named - `October 2026`. */
  readonly monthName: string;
  /** The current month's name, for the navigation action. */
  readonly currentMonthName: string;
  /** True when the selected month *is* the current one, which omits the action. */
  readonly isCurrentMonth: boolean;
  readonly onGoToCurrentMonth: () => void;
}

/** State `empty` - this month only: expenses exist, just not in the selected month. */
export function MonthEmpty({
  monthName,
  currentMonthName,
  isCurrentMonth,
  onGoToCurrentMonth,
}: MonthEmptyProps) {
  return (
    <View testID={MONTH_EMPTY_TEST_ID} style={styles.empty}>
      <Text style={styles.headline} accessibilityRole="header">
        {emptyMonthHeadline(monthName)}
      </Text>
      <Text style={styles.body}>{EMPTY_COPY.home.month.body}</Text>
      {/* Omitted, not disabled, when the current month is already selected: the action
          would be a no-op, and a dead button is worse than no button (§States). */}
      {isCurrentMonth ? null : (
        <Button
          label={goToMonthAction(currentMonthName)}
          variant="ghost"
          onPress={onGoToCurrentMonth}
          testID="empty-go-to-current"
        />
      )}
    </View>
  );
}

/**
 * State `loading:first-paint`: three skeleton rows.
 *
 * Shown only for the frame or two a local SQLite read takes, and never for longer than
 * 300ms - after that the honest answer is `empty`, not `loading`
 * (`02-offline-and-sync.md` §1). The screen owns that deadline; this just draws the rows.
 */
export function ListSkeleton() {
  return (
    <View
      testID={LIST_SKELETON_TEST_ID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <SkeletonBlock width={size.swatch} height={size.swatch} />
          <SkeletonBlock width={120} height={16} />
          <View style={styles.skeletonSpacer} />
          <SkeletonBlock width={64} height={16} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingTop: space[10],
    gap: space[2],
  },
  headline: {
    ...type.title2,
    color: color.text.primary,
    textAlign: 'center',
    marginTop: space[4],
  },
  body: {
    ...type.callout,
    color: color.text.secondary,
    textAlign: 'center',
    // §States: the first-run body is capped at 280 so it breaks into readable lines.
    maxWidth: 280,
    marginBottom: space[4],
  },
  skeletonRow: {
    minHeight: size.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.bg.surface,
    paddingHorizontal: space[4],
    gap: space[3],
  },
  skeletonSpacer: {
    flex: 1,
  },
});
