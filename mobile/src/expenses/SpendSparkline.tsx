import { StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const SPARKLINE_TEST_ID = 'spend-sparkline';
export const SPARKLINE_BAR_TEST_ID_PREFIX = 'spend-sparkline-bar';

const HEIGHT = 32;
const FLOOR = 3;

export interface SpendSparklineProps {
  /** Running spend for day 1..n, oldest first. Days past n are drawn as empty slots. */
  readonly series: readonly number[];
  readonly daysInMonth: number;
}

/**
 * A month at a glance: one thin bar per day, as tall as the running total so far. Decorative
 * - the total above it is the accessible figure, so this is hidden from screen readers.
 */
export function SpendSparkline({ series, daysInMonth }: SpendSparklineProps) {
  const styles = useStyles();
  const max = Math.max(0, ...series);
  if (max <= 0) return null;

  return (
    <View
      testID={SPARKLINE_TEST_ID}
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: daysInMonth }, (_, index) => {
        const value = series[index];
        const filled = value !== undefined;
        return (
          <View
            key={index}
            testID={`${SPARKLINE_BAR_TEST_ID_PREFIX}-${index + 1}`}
            style={[
              styles.bar,
              filled ? styles.past : styles.future,
              { height: filled ? Math.max(FLOOR + 1, (value / max) * HEIGHT) : FLOOR },
            ]}
          />
        );
      })}
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    row: {
      height: HEIGHT,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2,
      marginTop: space[2],
    },
    bar: { flex: 1, borderRadius: radius.sm / 4 },
    past: { backgroundColor: color.primary.default },
    future: { backgroundColor: color.border.hairline },
  }),
);
