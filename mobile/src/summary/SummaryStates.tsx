import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { SkeletonBlock } from '../components/Chrome';
import { EMPTY_COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

/**
 * The Summary's non-default states: `docs/design/08-monthly-summary.md` §States.
 *
 * Note which states are **not** here. There is no error state, and the spec is explicit
 * that there is no *reachable* one: every number on this screen comes from one local
 * `GROUP BY` over SQLite and there is no server reporting endpoint in the MVP, so there is
 * nothing to fail. A sync transport failure appears in the sync pill and must not blank or
 * grey the chart - stale-but-real numbers beat an error screen.
 *
 * There is no `offline-pending` state either, for a stronger reason: it is identical to
 * the default one. Pending expenses are included in the total, the chart and the legend
 * exactly as synced ones are, because they are real expenses that exist locally. The
 * aggregate does not know or care, which is the architecture working rather than a gap.
 */

export const SUMMARY_EMPTY_TEST_ID = 'summary-empty';
export const SUMMARY_SKELETON_TEST_ID = 'summary-skeleton';
export const SUMMARY_EMPTY_ILLUSTRATION_TEST_ID = 'summary-empty-illustration';

/** The donut's footprint, so the skeleton reserves exactly the space the chart will take. */
const DONUT_DIAMETER = 180;

/** Four rows, which is the spec's number and roughly what a real legend opens with. */
const SKELETON_ROWS = [0, 1, 2, 3];

/**
 * State `empty` - no expenses in the selected month.
 *
 * **The total still renders, as `$0.00` with `0 expenses`**, above this. It is not part of
 * this component because it is not part of the empty state: hiding the figure would make
 * it appear to pop into existence later, which is the rule Home follows too.
 *
 * There is no primary action, deliberately. The Expenses tab holds the add action, and a
 * second entry point to it here would be a competing one - so this state explains and
 * then stops.
 */
export function SummaryEmpty() {
  const color = useColors();
  const styles = useStyles();
  return (
    <View testID={SUMMARY_EMPTY_TEST_ID} style={styles.empty}>
      <Feather
        testID={SUMMARY_EMPTY_ILLUSTRATION_TEST_ID}
        name="pie-chart"
        size={48}
        color={color.text.tertiary}
        // The headline carries the meaning; a screen reader hearing "image" first would
        // be hearing the one element here that says nothing.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.headline} accessibilityRole="header">
        {EMPTY_COPY.summary.headline}
      </Text>
      <Text style={styles.body}>{EMPTY_COPY.summary.body}</Text>
    </View>
  );
}

/**
 * State `loading:first-paint`: a circle where the donut goes and four legend rows.
 *
 * Shown for the frame or two a local SQLite read takes and never longer than 300ms - after
 * that the honest answer is `empty`, not `loading` (`02-offline-and-sync.md` §1). The
 * screen owns that deadline (`useFirstPaintSkeleton`); this just draws the shapes.
 *
 * No shimmer. It would be motion with no meaning, which Reduce Motion would then have to
 * suppress, on a state that is almost never seen.
 */
export function SummarySkeleton() {
  const styles = useStyles();
  return (
    <View
      testID={SUMMARY_SKELETON_TEST_ID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.skeletonDonut}>
        <SkeletonBlock
          width={DONUT_DIAMETER}
          height={DONUT_DIAMETER}
          // A pill radius on a square is a circle, so the placeholder has the shape of the
          // thing it stands in for rather than a block that jumps into a ring.
          radius={radius.pill}
        />
      </View>
      <View style={styles.skeletonLegend}>
        {SKELETON_ROWS.map((index) => (
          <View key={index} style={styles.skeletonRow}>
            <SkeletonBlock width={16} height={16} />
            <SkeletonBlock width={120} height={16} />
            <View style={styles.skeletonSpacer} />
            <SkeletonBlock width={64} height={16} />
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    empty: {
      alignItems: 'center',
      paddingHorizontal: space[4],
      // §States: `space.10` below the total.
      paddingTop: space[10],
      gap: space[2],
    },
    headline: {
      ...type.title2,
      color: color.text.primary,
      textAlign: 'center',
      // §States: `space.6` under the illustration, then `space.2` under the headline.
      marginTop: space[6],
    },
    body: {
      ...type.callout,
      color: color.text.secondary,
      textAlign: 'center',
      maxWidth: 280,
    },
    skeletonDonut: {
      alignItems: 'center',
      marginVertical: space[6],
    },
    skeletonLegend: {
      backgroundColor: color.bg.surface,
    },
    skeletonRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space[4],
      gap: space[3],
    },
    skeletonSpacer: {
      flex: 1,
    },
  }),
);
