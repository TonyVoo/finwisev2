import { StyleSheet, Text, View } from 'react-native';
import { categoryColor, categoryColorDark, radius, space, type } from '../theme/tokens';
import { createStyles, useTheme } from '../theme/ThemeProvider';
import { formatShare } from './investModel';
import { hueFor } from './SymbolAvatar';
import type { Position } from './portfolioModel';

/**
 * How the portfolio is split between what is held: one bar, a segment per holding, widest first, with the
 * biggest few named beneath. Concentration is the thing a person most wants to see at a glance and least wants
 * to work out from a list.
 */

export const ALLOCATION_TEST_ID = 'portfolio-allocation';
const LEGEND_MAX = 4;

export interface Slice {
  readonly symbol: string;
  /** 0..1 of the whole. */
  readonly share: number;
}

/** Each holding's share of the total cost, widest first; empty when nothing is held. */
export function allocationOf(positions: readonly Position[]): readonly Slice[] {
  const total = positions.reduce((sum, p) => sum + p.cost, 0);
  if (total <= 0) return [];
  return positions
    .map((p) => ({ symbol: p.symbol, share: p.cost / total }))
    .sort((a, b) => b.share - a.share || a.symbol.localeCompare(b.symbol));
}

export function AllocationBar({ positions }: { readonly positions: readonly Position[] }) {
  const styles = useStyles();
  const { isDark } = useTheme();
  const slices = allocationOf(positions);
  if (slices.length === 0) return null;
  const hex = (symbol: string) => (isDark ? categoryColorDark : categoryColor)[hueFor(symbol)];

  return (
    <View testID={ALLOCATION_TEST_ID} style={styles.wrap}>
      <View
        style={styles.bar}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {slices.map((slice) => (
          <View
            key={slice.symbol}
            style={{ flex: slice.share, backgroundColor: hex(slice.symbol) }}
          />
        ))}
      </View>
      <View
        style={styles.legend}
        accessible
        accessibilityLabel={slices
          .slice(0, LEGEND_MAX)
          .map((slice) => `${slice.symbol} ${formatShare(slice.share)}`)
          .join(', ')}
      >
        {slices.slice(0, LEGEND_MAX).map((slice) => (
          <View key={slice.symbol} style={styles.item}>
            <View style={[styles.dot, { backgroundColor: hex(slice.symbol) }]} />
            <Text style={styles.label}>{`${slice.symbol} ${formatShare(slice.share)}`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { gap: space[2] },
    bar: {
      flexDirection: 'row',
      height: 10,
      borderRadius: radius.pill,
      overflow: 'hidden',
      gap: 2,
      backgroundColor: color.bg.sunken,
    },
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space[3], rowGap: space[1] },
    item: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: { ...type.caption, color: color.text.secondary, fontVariant: ['tabular-nums'] },
  }),
);
