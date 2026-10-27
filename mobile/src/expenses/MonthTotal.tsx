import { StyleSheet, Text, View } from 'react-native';
import { SkeletonBlock } from '../components/Chrome';
import { COPY, summaryExpenseCount } from '../copy/strings';
import { formatMoney } from '../lib/money';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * The month total: `docs/design/04-expense-list.md` elements 6 and 7.
 *
 * Three rules from that spec meet in this small component:
 *
 * - **It is one accessibility element, labelled as money** (§Accessibility rule 5, and
 *   `00-foundations.md` §8 rule 3). The label is the *formatted* string - `$1,284.50` -
 *   which both VoiceOver and TalkBack read correctly as currency. A screen reader must
 *   never reach the raw `amountMinor`, which would be read as "one hundred twenty eight
 *   thousand four hundred fifty".
 * - **`accessibilityLiveRegion="polite"`**, so the total's change after an add or a delete
 *   is announced without stealing focus. The announcement is the only confirmation a
 *   non-sighted user gets that the figure moved.
 * - **The zero total renders as `$0.00`**, never as a dash or a blank, and it renders on
 *   first run too: "hiding it would make the number appear to pop into existence later"
 *   (state `empty` - first run).
 *
 * The label changes with the month and the figure does not: `Total this month` only while
 * the current month is selected, `Total` otherwise. A month in the past labelled "this
 * month" would be a plain lie about which number the user is reading.
 *
 * **Both tabs render this same component** - the copy deck lists `home.total.current` as
 * belonging to "Home, Summary" - and the Summary adds the expense count beneath the figure
 * (`08-monthly-summary.md` elements 5-7). Sharing it is what keeps the two screens' money
 * typography, their skeleton and their live region identical; the figures themselves agree
 * because they are the same aggregate, not because of anything here.
 */

export const MONTH_TOTAL_TEST_ID = 'month-total';
export const MONTH_TOTAL_SKELETON_TEST_ID = 'month-total-skeleton';
export const MONTH_TOTAL_COUNT_TEST_ID = 'month-total-count';

export interface MonthTotalProps {
  /** In minor units. `undefined` while the first SQLite read is in flight. */
  readonly totalMinor: number | undefined;
  readonly currency: string;
  readonly isCurrentMonth: boolean;
  /**
   * How many expenses the figure is made of - the Summary's third line (element 7 of
   * `08-monthly-summary.md`), and the deck's `, {count} expenses` appended to this block's
   * composed label.
   *
   * Omitted on Home, where the rows are right there to be counted and the spec has no line
   * for it. Zero is a value and renders: the empty state shows `$0.00` with `0 expenses`.
   */
  readonly count?: number;
}

export function MonthTotal({ totalMinor, currency, isCurrentMonth, count }: MonthTotalProps) {
  const styles = useStyles();
  const label = isCurrentMonth ? COPY.home.total.current : COPY.home.total.other;

  if (totalMinor === undefined) {
    // State `loading:first-paint`: a 160x32 block where the figure goes. No shimmer - it
    // would violate Reduce Motion for no gain over a read that resolves in a frame.
    return (
      <View style={styles.block}>
        <Text style={styles.label}>{label}</Text>
        <SkeletonBlock testID={MONTH_TOTAL_SKELETON_TEST_ID} width={160} height={32} />
      </View>
    );
  }

  const formatted = formatMoney(totalMinor, currency);
  const counted = count === undefined ? null : summaryExpenseCount(count);

  return (
    <View
      testID={MONTH_TOTAL_TEST_ID}
      style={styles.block}
      // One element: the caption, the figure and the count are meaningless apart.
      accessible
      accessibilityLabel={
        counted === null ? `${label}, ${formatted}` : `${label}, ${formatted}, ${counted}`
      }
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.amount}>{formatted}</Text>
      {counted === null ? null : (
        <Text testID={MONTH_TOTAL_COUNT_TEST_ID} style={styles.count}>
          {counted}
        </Text>
      )}
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    block: {
      backgroundColor: color.bg.surface,
      paddingHorizontal: space[4],
      paddingTop: space[3],
      paddingBottom: space[4],
      gap: space[1],
    },
    label: {
      ...type.caption,
      color: color.text.tertiary,
    },
    amount: {
      ...type.display,
      color: color.text.primary,
      fontVariant: ['tabular-nums'],
    },
    count: {
      ...type.footnote,
      color: color.text.tertiary,
    },
  }),
);
