import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Pie, PolarChart } from 'victory-native';
import { monthName, type MonthKey } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import { displayCategoryColor, motion, size, space, type } from '../theme/tokens';
import { createStyles, useColors, useTheme } from '../theme/ThemeProvider';
import type { SpendEntry } from './summaryModel';

/**
 * The donut: `docs/design/08-monthly-summary.md` elements 8-10.
 *
 * **It is a picture of the legend** (rule 6), and that one sentence decides most of what
 * is and is not here:
 *
 * - **Nothing is interactive.** No tap-to-select, no tooltip, no legend filtering. The
 *   legend below already shows every value the chart encodes, in text, permanently - a
 *   tooltip would reveal nothing new while adding a hit-testing surface that assistive
 *   technology cannot reach and that is fiddly on a 180px ring.
 * - **It is hidden from assistive technology entirely** (§Accessibility rule 1). An SVG
 *   donut cannot be read usefully; a list of labelled amounts can, and that is the legend.
 *   This is why the legend is mandatory and always visible rather than collapsible.
 * - **It is drawn only when the month total is positive** (rule 11). That is both the
 *   guard against dividing by zero in the percentages and the reason a zero-value donut
 *   never appears: an empty ring reads as a loading state or as a bug.
 *
 * Two details that look cosmetic and are not. The **2px separating stroke** between
 * slices is required: the category palette is separated by hue at near-identical luminance
 * (`00-foundations.md` §1.3), so two adjacent slices can be indistinguishable in greyscale
 * or to a user with deuteranopia, and the stroke is what keeps the boundary visible. And
 * the slices are drawn **in legend order from 12 o'clock, clockwise** (rule 4), so the
 * largest is immediately readable and the ring matches the list beneath it.
 */

export const DONUT_TEST_ID = 'summary-donut';
export const DONUT_CENTRE_TEST_ID = 'summary-donut-centre';

/** Element 8: 180 diameter, 28 stroke. The ring's inner edge follows from the two. */
const DIAMETER = 180;
const INNER_RADIUS = DIAMETER / 2 - size.donutStrokeWidth;

/**
 * Where the centre label gives way (§Accessibility rule 6).
 *
 * The donut itself does **not** scale with font size - it carries no body text - so its
 * centre label is the only part that has to answer for dynamic type. It drops to
 * `type.callout` at the scale the legend starts stacking at, and above 1.5 it is omitted
 * altogether: the same figure is already on screen at `type.display` directly above the
 * chart, so the honest answer at that point is to show it once rather than to shrink it
 * twice.
 */
const CENTRE_COMPACT_FONT_SCALE = 1.3;
const CENTRE_OMITTED_FONT_SCALE = 1.5;

export interface CategoryDonutProps {
  /** Legend order, every entry with a non-zero amount (`summariseMonth`). */
  readonly entries: readonly SpendEntry[];
  readonly totalMinor: number;
  readonly currency: string;
  /** The selected month, for the centre caption - `October`. */
  readonly month: MonthKey;
}

export function CategoryDonut({ entries, totalMinor, currency, month }: CategoryDonutProps) {
  const color = useColors();
  const { isDark } = useTheme();
  const styles = useStyles();
  const { fontScale } = useWindowDimensions();
  const opacity = useMountFade();

  const data = entries.map((entry) => ({
    label: entry.name,
    // Minor units, straight from the aggregate. The chart takes the ratio of these, which
    // is the exact share rather than the rounded percentage the legend prints (rule 3).
    value: entry.totalMinor,
    color: displayCategoryColor(entry.color, isDark),
  }));

  return (
    <Animated.View
      testID={DONUT_TEST_ID}
      style={[styles.chart, { opacity }]}
      // The legend is the accessible representation of everything in here (rule 1). Both
      // props are needed: the first is iOS, the second Android.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PolarChart
        data={data}
        labelKey="label"
        valueKey="value"
        colorKey="color"
        // Fixed, so the ring renders on its first frame rather than after an `onLayout`
        // round trip. The size is the spec's and does not depend on the viewport.
        explicitSize={{ width: DIAMETER, height: DIAMETER }}
      >
        <Pie.Chart
          innerRadius={INNER_RADIUS}
          // Skia measures angles from 3 o'clock, so 12 o'clock is -90 (rule 4).
          startAngle={-90}
        >
          {() => (
            <Pie.Slice>
              {/* The required separator, in the surface colour so it reads as a gap. */}
              <Pie.SliceAngularInset
                angularInset={{
                  angularStrokeWidth: size.sliceGapStrokeWidth,
                  angularStrokeColor: color.bg.surface,
                }}
              />
            </Pie.Slice>
          )}
        </Pie.Chart>
      </PolarChart>

      {fontScale > CENTRE_OMITTED_FONT_SCALE ? null : (
        <View style={styles.centre} testID={DONUT_CENTRE_TEST_ID} pointerEvents="none">
          <Text
            style={
              fontScale > CENTRE_COMPACT_FONT_SCALE ? styles.centreCompact : styles.centreTotal
            }
            numberOfLines={1}
          >
            {formatMoney(totalMinor, currency)}
          </Text>
          <Text style={styles.centreMonth} numberOfLines={1}>
            {monthName(month)}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

/**
 * The one piece of motion on this screen: a `motion.base` fade on mount (rule 6).
 *
 * Suppressed under Reduce Motion, where the chart renders at full opacity immediately
 * (§Accessibility rule 5). No motion here is load-bearing for meaning - there is no
 * slice-growth or rotation animation in any case - so suppressing it loses nothing.
 *
 * The preference is read asynchronously, so the first frame has to assume *something*. It
 * assumes Reduce Motion is **on**, i.e. it starts at full opacity and only animates once
 * the platform has said motion is wanted. Starting transparent and fading in before the
 * answer arrives would play the animation this exists to suppress.
 */
function useMountFade(): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion !== false) return;
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: motion.base.duration,
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, opacity]);

  return opacity;
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    chart: {
      width: DIAMETER,
      height: DIAMETER,
      alignSelf: 'center',
      marginVertical: space[6],
    },
    centre: {
      // Overlaid on the ring rather than drawn into it: Skia text needs a font loaded as an
      // asset, and a real `Text` is the thing that scales with dynamic type and can be
      // hidden from assistive technology with the rest of the chart.
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centreTotal: {
      ...type.bodyStrong,
      color: color.text.primary,
      fontVariant: ['tabular-nums'],
    },
    centreCompact: {
      ...type.callout,
      color: color.text.primary,
      fontVariant: ['tabular-nums'],
    },
    centreMonth: {
      ...type.caption,
      color: color.text.tertiary,
    },
  }),
);
