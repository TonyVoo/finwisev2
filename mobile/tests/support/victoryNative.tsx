import { type ReactNode, createContext, useContext } from 'react';
import { View } from 'react-native';

/**
 * `victory-native`, stood in for under jest.
 *
 * The real package draws through `@shopify/react-native-skia`, which is a Skia canvas
 * behind a native module. Running it here would mean a second jest project with its own
 * environment, `canvaskit-wasm` loaded into the process, and the whole suite paying for it
 * - to assert on pixels that no test in this repo asserts on anyway. The chart is also the
 * one element on the Summary screen that is **hidden from assistive technology on purpose**
 * (`docs/design/08-monthly-summary.md` §Accessibility rule 1): the legend is its accessible
 * representation, and the legend is real in these tests.
 *
 * So what is faked is the *renderer*, and what the tests still exercise is everything on
 * this side of it:
 *
 * - the data the screen hands the chart - one datum per legend row, in legend order, each
 *   carrying the category's own colour,
 * - the slice subtree the screen builds, including the separating stroke, since `Pie.Chart`
 *   below calls its render callback once per datum exactly as the real one does, and
 *   `screen.queryByTestId` can count what came back,
 * - that the donut is mounted at all, which is the condition rule 11 puts on it.
 *
 * What it does not exercise is the geometry: no angles are computed here, and nothing
 * asserts on them. The share each slice is drawn at is pinned where it is decided instead,
 * as arithmetic, in `tests/summary/summaryModel.test.ts`.
 */

export const POLAR_CHART_TEST_ID = 'victory-polar-chart';
export const PIE_SLICE_TEST_ID = 'victory-pie-slice';
export const PIE_SLICE_INSET_TEST_ID = 'victory-pie-slice-inset';

/** The slice the real `Pie.Chart` passes its children. Zeroed: no layout happens here. */
export interface PieSliceData {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly sweepAngle: number;
}

interface ChartDatum {
  readonly [key: string]: unknown;
}

interface ChartContextValue {
  readonly data: readonly ChartDatum[];
  readonly labelKey: string;
  readonly valueKey: string;
  readonly colorKey: string;
}

const ChartContext = createContext<ChartContextValue | null>(null);

export function PolarChart({
  data,
  labelKey,
  valueKey,
  colorKey,
  children,
}: {
  readonly data: readonly ChartDatum[];
  readonly labelKey: string;
  readonly valueKey: string;
  readonly colorKey: string;
  readonly children?: ReactNode;
  // The sizing and style props the real component takes. Accepted and ignored: they are
  // layout, and layout is what this stub does not do.
  readonly explicitSize?: { readonly width: number; readonly height: number };
  readonly containerStyle?: unknown;
  readonly canvasStyle?: unknown;
}) {
  return (
    <View testID={POLAR_CHART_TEST_ID}>
      <ChartContext.Provider value={{ data, labelKey, valueKey, colorKey }}>
        {children}
      </ChartContext.Provider>
    </View>
  );
}

function PieChart({
  children,
}: {
  readonly children?: (args: { readonly slice: PieSliceData }) => ReactNode;
  readonly innerRadius?: number | string;
  readonly startAngle?: number;
  readonly circleSweepDegrees?: number;
  readonly size?: number;
}) {
  const chart = useContext(ChartContext);
  if (chart === null) throw new Error('Pie.Chart must be used inside PolarChart');

  return (
    <>
      {chart.data.map((datum, index) => {
        const slice: PieSliceData = {
          label: String(datum[chart.labelKey]),
          value: Number(datum[chart.valueKey]),
          color: String(datum[chart.colorKey]),
          startAngle: 0,
          endAngle: 0,
          sweepAngle: 0,
        };
        return (
          <View
            key={`${slice.label}-${index}`}
            testID={PIE_SLICE_TEST_ID}
            // The two values a test has any business reading off a slice, as props rather
            // than as an accessibility label - the chart has no accessible name by design.
            accessibilityValue={{ text: `${slice.label}:${slice.value}:${slice.color}` }}
          >
            {children?.({ slice })}
          </View>
        );
      })}
    </>
  );
}

export const Pie = {
  Chart: PieChart,
  Slice: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
  SliceAngularInset: ({
    angularInset,
  }: {
    readonly angularInset: {
      readonly angularStrokeWidth: number;
      readonly angularStrokeColor: string;
    };
  }) => (
    <View
      testID={PIE_SLICE_INSET_TEST_ID}
      accessibilityValue={{
        text: `${angularInset.angularStrokeWidth}:${String(angularInset.angularStrokeColor)}`,
      }}
    />
  ),
};
