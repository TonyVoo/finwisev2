import type { MarketQuotePoint } from '@expense-tracker/shared';
import { memo, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { COPY } from '../copy/strings';
import { keyHaptic } from '../lib/haptics';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { ChangePill } from './ChangePill';
import {
  CHART_RANGES,
  type ChartRange,
  columnAt,
  downsample,
  rangeChange,
  resampleRatios,
  sliceRange,
  sourceIndex,
  strokeOf,
  toBars,
} from './chartModel';

/**
 * A stock's closing prices as a filled line chart, with a pill per range, and a finger that reads the price on
 * any day: press and drag across the chart and a crosshair follows, the header turns into that day's date and
 * price, and a light tick marks each new day under the finger. Let go and it returns to the range's change.
 *
 * Plain Views, no chart library: each column is a sliver of fill under a cap that joins to its neighbour's, so
 * the top edge reads as one line. That keeps it renderable in tests and gives each day a labelled element for a
 * screen reader. The line is green if the range closed higher than it opened and red if lower: the stretch
 * you are looking at, not the day.
 */

export const PRICE_CHART_TEST_ID = 'invest-chart';
export const PRICE_CHART_BAR_PREFIX = 'invest-chart-bar';
export const PRICE_CHART_RANGE_PREFIX = 'invest-chart-range';
export const PRICE_CHART_READOUT_TEST_ID = 'invest-chart-readout';

const HEIGHT = 132;
const COLUMN_WIDTH = 2;

const LABELS: Readonly<Record<ChartRange, () => string>> = {
  '1m': () => COPY.invest.range1m,
  '3m': () => COPY.invest.range3m,
  '6m': () => COPY.invest.range6m,
  '1y': () => COPY.invest.range1y,
};

export function PriceChart({
  series,
  format,
}: {
  readonly series: readonly MarketQuotePoint[];
  /** How a close is written, for the readout and a bar's spoken label. */
  readonly format: (close: number) => string;
}) {
  const styles = useStyles();
  const color = useColors();
  const [range, setRange] = useState<ChartRange>('3m');
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const last = useRef<number | null>(null);

  const inRange = useMemo(() => sliceRange(series, range), [series, range]);
  const columns = width > 0 ? Math.max(20, Math.floor(width / COLUMN_WIDTH)) : 60;
  const points = useMemo(() => downsample(inRange, columns), [inRange, columns]);
  const ratios = useMemo(
    () =>
      resampleRatios(
        toBars(points).map((bar) => bar.ratio),
        columns,
      ),
    [points, columns],
  );

  const change = rangeChange(inRange);
  const down = change !== null && change < 0;
  const line = down ? color.danger.default : color.success.default;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only a mostly-horizontal drag takes the gesture, so a vertical swipe that starts on the chart still
        // scrolls the page; once taken, the chart keeps it and a vertical wobble does not hand it back.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => update(event.nativeEvent.locationX),
        onPanResponderMove: (event) => update(event.nativeEvent.locationX),
        onPanResponderRelease: () => end(),
        onPanResponderTerminate: () => end(),
      }),
    [width, columns, points.length],
  );

  function update(x: number): void {
    const column = columnAt(x, width, columns);
    if (column === null) return;
    // A tick for each new day, not each new column: several columns can stand for one day.
    const day = sourceIndex(column, columns, points.length);
    if (day !== last.current) {
      last.current = day;
      keyHaptic();
    }
    setScrub(column);
  }

  function end(): void {
    last.current = null;
    setScrub(null);
  }

  const scrubbed =
    scrub === null ? null : (points[sourceIndex(scrub, columns, points.length)] ?? null);

  return (
    <View testID={PRICE_CHART_TEST_ID} style={styles.wrap}>
      <View
        style={styles.readout}
        testID={PRICE_CHART_READOUT_TEST_ID}
        accessibilityLiveRegion="polite"
      >
        {scrubbed === null ? (
          <>
            <Text style={styles.readoutCaption}>{rangeCaption(range)}</Text>
            <ChangePill fraction={change} size="small" />
          </>
        ) : (
          <>
            <Text style={styles.readoutCaption}>{scrubbed.date}</Text>
            <Text style={styles.readoutValue}>{format(scrubbed.close)}</Text>
          </>
        )}
      </View>

      <View
        style={[styles.plot, { height: HEIGHT }]}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        accessibilityHint={COPY.invest.scrubHint}
      >
        <View style={styles.columns}>
          {ratios.map((ratio, index) => {
            const stroke = strokeOf(ratios, index, 2 / HEIGHT);
            const source = points[sourceIndex(index, columns, points.length)];
            return (
              <ChartColumn
                key={index}
                testID={`${PRICE_CHART_BAR_PREFIX}-${source?.date ?? 'x'}-${index}`}
                label={
                  source !== undefined && index % Math.ceil(columns / 12) === 0
                    ? `${source.date}, ${format(source.close)}`
                    : undefined
                }
                ratio={ratio}
                strokeBottom={stroke.bottom}
                strokeHeight={stroke.height}
                color={line}
                active={scrub === index}
              />
            );
          })}
        </View>

        {scrub === null || points.length === 0 ? null : (
          <View
            pointerEvents="none"
            style={[styles.cross, { left: ((scrub + 0.5) / columns) * width - 0.5 }]}
          >
            <View style={[styles.crossLine, { backgroundColor: color.text.tertiary }]} />
          </View>
        )}
        <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
      </View>

      <View style={styles.ranges} accessibilityRole="tablist">
        {CHART_RANGES.map((candidate) => {
          const selected = candidate === range;
          return (
            <Pressable
              key={candidate}
              testID={`${PRICE_CHART_RANGE_PREFIX}-${candidate}`}
              onPress={() => {
                keyHaptic();
                setRange(candidate);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.rangeButton, selected ? styles.rangeSelected : null]}
            >
              <Text style={[styles.rangeText, selected ? styles.rangeTextSelected : null]}>
                {LABELS[candidate]()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * One column of the chart. Memoised on plain values, so dragging a finger across the chart re-renders the two
 * columns whose `active` flag changed instead of every column on every move.
 */
const ChartColumn = memo(function ChartColumn({
  testID,
  label,
  ratio,
  strokeBottom,
  strokeHeight,
  color,
  active,
}: {
  readonly testID: string;
  readonly label: string | undefined;
  readonly ratio: number;
  readonly strokeBottom: number;
  readonly strokeHeight: number;
  readonly color: string;
  readonly active: boolean;
}) {
  const styles = useStyles();
  return (
    <View
      testID={testID}
      accessible={label !== undefined}
      accessibilityLabel={label}
      style={styles.column}
    >
      <View
        style={{ height: ratio * HEIGHT, backgroundColor: color, opacity: active ? 0.34 : 0.14 }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: strokeBottom * HEIGHT,
          height: strokeHeight * HEIGHT,
          backgroundColor: color,
        }}
      />
    </View>
  );
});

function rangeCaption(range: ChartRange): string {
  return LABELS[range]();
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: { gap: space[3] },
    readout: {
      height: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    readoutCaption: { ...type.subhead, color: color.text.secondary },
    readoutValue: { ...type.bodyStrong, color: color.text.primary, fontVariant: ['tabular-nums'] },
    plot: { justifyContent: 'flex-end' },
    columns: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
    column: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    cross: { position: 'absolute', top: 0, bottom: 0, width: 1 },
    crossLine: { flex: 1, width: 1, opacity: 0.6 },
    ranges: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: color.bg.sunken,
    },
    rangeButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: space[1] + 2,
      borderRadius: radius.pill,
    },
    rangeSelected: { backgroundColor: color.bg.surface },
    rangeText: { ...type.subhead, color: color.text.tertiary },
    rangeTextSelected: { color: color.text.primary },
  }),
);
