import { StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { monthShortLabel, monthSpokenLabel } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import type { Trend } from './trendModel';

/**
 * Spend over the last six months, as bars.
 *
 * Plain Views rather than a chart library: six rectangles need no SVG, render in the jest
 * environment unmocked, and scale with the layout. Unlike the donut this one *is* readable
 * by assistive technology - each bar is one labelled element ("October 2026, $1,284.50"),
 * so nothing here is decoration that a screen reader has to skip.
 *
 * The selected month is the solid bar, the others are the muted tint, so the chart answers
 * "is this month high or low for me?" without a legend. A month with no spend shows a
 * hairline stub rather than nothing, so six slots are always visible and an empty month
 * reads as "zero", not "missing".
 */

export const TREND_TEST_ID = 'summary-trend';
export const TREND_BAR_TEST_ID_PREFIX = 'summary-trend-bar';

/** Height of the tallest bar. Fixed, so the card is the same size whatever the data. */
const BAR_AREA_HEIGHT = 120;
const MIN_STUB = 2;

export interface SpendTrendProps {
  readonly trend: Trend;
  readonly currency: string;
}

export function SpendTrend({ trend, currency }: SpendTrendProps) {
  const styles = useStyles();

  return (
    <View testID={TREND_TEST_ID} style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">
        {COPY.summary.trend.title}
      </Text>
      <View style={styles.bars}>
        {trend.bars.map((bar) => (
          <View
            key={bar.month}
            testID={`${TREND_BAR_TEST_ID_PREFIX}-${bar.month}`}
            style={styles.column}
            accessible
            accessibilityLabel={`${monthSpokenLabel(bar.month)}, ${formatMoney(bar.totalMinor, currency)}`}
          >
            <View style={styles.barArea}>
              <View
                style={[
                  styles.bar,
                  bar.selected ? styles.barSelected : styles.barMuted,
                  { height: Math.max(MIN_STUB, Math.round(bar.fraction * BAR_AREA_HEIGHT)) },
                ]}
              />
            </View>
            <Text
              style={[styles.label, bar.selected ? styles.labelSelected : null]}
              numberOfLines={1}
            >
              {monthShortLabel(bar.month)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      backgroundColor: color.bg.surface,
      borderRadius: radius.lg,
      marginHorizontal: space[4],
      marginTop: space[4],
      marginBottom: space[4],
      padding: space[4],
    },
    heading: { ...type.headline, color: color.text.primary, marginBottom: space[4] },
    bars: { flexDirection: 'row', gap: space[2] },
    column: { flex: 1, alignItems: 'center' },
    barArea: { height: BAR_AREA_HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch' },
    bar: { borderRadius: radius.sm, alignSelf: 'stretch' },
    barSelected: { backgroundColor: color.primary.default },
    barMuted: { backgroundColor: color.border.strong },
    label: { ...type.caption, color: color.text.tertiary, marginTop: space[2] },
    labelSelected: { color: color.text.primary },
  }),
);
