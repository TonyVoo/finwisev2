import { StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * Where today's price sits in the year's range: a track from the low to the high with a dot on it. It reads in a
 * glance what two numbers in a sentence do not.
 */

export const RANGE_BAR_TEST_ID = 'invest-range-bar';

/** Where `close` sits between `low` and `high`, 0..1; the middle when the range has no width. */
export function positionInRange(close: number, low: number, high: number): number {
  if (high <= low) return 0.5;
  return Math.min(1, Math.max(0, (close - low) / (high - low)));
}

export function RangeBar({
  close,
  low,
  high,
  format,
}: {
  readonly close: number;
  readonly low: number;
  readonly high: number;
  readonly format: (value: number) => string;
}) {
  const styles = useStyles();
  const position = positionInRange(close, low, high);
  return (
    <View
      testID={RANGE_BAR_TEST_ID}
      accessible
      accessibilityLabel={`${COPY.invest.rangeTitle}: ${format(low)}, ${format(high)}`}
      style={styles.wrap}
    >
      <Text style={styles.title}>{COPY.invest.rangeTitle}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${position * 100}%` }]} />
        <View style={[styles.dot, { left: `${position * 100}%` }]} />
      </View>
      <View style={styles.ends}>
        <Text style={styles.end}>{format(low)}</Text>
        <Text style={styles.end}>{format(high)}</Text>
      </View>
    </View>
  );
}

const DOT = 14;

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { gap: space[2] },
    title: { ...type.subhead, color: color.text.secondary },
    track: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: color.bg.sunken,
      justifyContent: 'center',
    },
    fill: {
      position: 'absolute',
      left: 0,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: color.primary.subtle,
    },
    dot: {
      position: 'absolute',
      width: DOT,
      height: DOT,
      marginLeft: -DOT / 2,
      borderRadius: DOT / 2,
      backgroundColor: color.primary.default,
      borderWidth: 2,
      borderColor: color.bg.surface,
    },
    ends: { flexDirection: 'row', justifyContent: 'space-between' },
    end: { ...type.caption, color: color.text.tertiary, fontVariant: ['tabular-nums'] },
  }),
);
