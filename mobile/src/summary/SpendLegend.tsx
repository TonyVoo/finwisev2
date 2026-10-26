import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { formatMoney } from '../lib/money';
import { color, radius, space, type } from '../theme/tokens';
import { budgetLabel, legendRowLabel, type SpendEntry } from './summaryModel';

/**
 * The legend: `docs/design/08-monthly-summary.md` elements 11-15.
 *
 * This is not a caption for the chart - it is **the accessible representation of it**
 * (§Accessibility rule 1), and the chart is the picture of this. Which is why it is always
 * visible rather than collapsible, why it names every category in text, and why the
 * swatch beside each name is decoration: colour is never the only carrier of category
 * identity here (§Accessibility rule 4), so the whole screen still works in greyscale.
 *
 * **Each row is one accessibility element** with the composed label
 * `{name}, {amount}, {percent} percent of the month` (`summaryModel.ts`). A row read as
 * four separate elements - a swatch, a name, an amount, a percentage - would make a
 * screen-reader user swipe four times to hear one fact.
 *
 * **Small categories are not grouped into "Other"** (rule 7). Every category with spend
 * gets its own row; with a realistic maximum of a dozen user categories, an "Other" bucket
 * would hide data to solve a crowding problem this screen does not have. If the legend is
 * long, it scrolls.
 *
 * Rule 8's drill-down - tapping a row to see that category's expenses for the month - is
 * **not implemented here**, and deliberately not faked: it needs a category filter on the
 * Expenses tab that `04-expense-list.md` does not specify and the list screen does not
 * have. A row that looked tappable and did nothing would be worse than a row that does
 * not, so the rows carry no `button` role and no hint. Raised on `TVO-12`.
 */

export const LEGEND_TEST_ID = 'summary-legend';
export const LEGEND_ROW_TEST_ID_PREFIX = 'legend-row';
export const LEGEND_SWATCH_TEST_ID_PREFIX = 'legend-swatch';

/**
 * Above this scale a row stacks: name on the first line, amount and percent on the second,
 * leading-aligned (§Accessibility rule 6). Side by side at four times the text size, the
 * name would be squeezed to an ellipsis by the two figures beside it.
 */
const STACK_FONT_SCALE = 1.3;

/** Element 15: the percentage column is a fixed width, so the amounts above it align. */
const PERCENT_WIDTH = 44;

/**
 * Element 11's row floor and element 12's swatch, as local constants.
 *
 * Neither is a `size` token and neither should be: `tokens.json` carries the sizes that
 * recur across screens, and `tests/theme/tokens.test.ts` asserts the module mirrors that
 * file exactly. These two occur here. Same reasoning as `MonthSwitcher`'s `BAR_MIN_HEIGHT`.
 * The legend swatch is also deliberately smaller than the list's 24 `size.swatch`: it sits
 * beside a `type.body` name rather than leading a 56-tall row.
 */
const ROW_MIN_HEIGHT = 48;
const SWATCH_SIZE = 16;

export interface SpendLegendProps {
  readonly entries: readonly SpendEntry[];
  readonly currency: string;
}

export function SpendLegend({ entries, currency }: SpendLegendProps) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > STACK_FONT_SCALE;

  return (
    <View testID={LEGEND_TEST_ID} style={styles.legend}>
      {entries.map((entry, index) => (
        <LegendRow
          key={entry.categoryId ?? `orphan-${index}`}
          entry={entry}
          currency={currency}
          stacked={stacked}
          first={index === 0}
        />
      ))}
    </View>
  );
}

function LegendRow({
  entry,
  currency,
  stacked,
  first,
}: {
  readonly entry: SpendEntry;
  readonly currency: string;
  readonly stacked: boolean;
  readonly first: boolean;
}) {
  const id = entry.categoryId ?? 'uncategorized';

  return (
    <View
      testID={`${LEGEND_ROW_TEST_ID_PREFIX}-${id}`}
      style={[styles.row, first ? null : styles.separator]}
      accessible
      accessibilityLabel={legendRowLabel(entry, currency)}
    >
      <View style={[styles.main, stacked ? styles.rowStacked : null]}>
        <View style={styles.leading}>
          <View
            testID={`${LEGEND_SWATCH_TEST_ID_PREFIX}-${id}`}
            style={[styles.swatch, { backgroundColor: entry.color }]}
            // The name is right beside it in text, so announcing the swatch would be
            // announcing the same thing twice - and "image" is all it could say.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={styles.name} numberOfLines={1}>
            {entry.name}
          </Text>
        </View>

        <View style={[styles.figures, stacked ? styles.figuresStacked : null]}>
          {/* Never truncated: a clipped amount is worse than a taller row
            (`04-expense-list.md` §Accessibility rule 4). */}
          <Text style={styles.amount} numberOfLines={1}>
            {formatMoney(entry.totalMinor, currency)}
          </Text>
          {/* Absent only when the month sums to zero, where there is no share to state. The
            column is dropped rather than filled with a dash, which would read as a value. */}
          {entry.percentLabel === null ? null : (
            <Text style={styles.percent} numberOfLines={1}>
              {entry.percentLabel}
            </Text>
          )}
        </View>
      </View>

      {/* Only on a category that has a budget. The words carry the state; the bar and the
          red are reinforcement, so the row still reads in greyscale (§Accessibility rule 4). */}
      {entry.budget === null ? null : (
        <View style={styles.budget} testID={`legend-budget-${id}`}>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${Math.round(entry.budget.fill * 100)}%` },
                entry.budget.over ? styles.fillOver : null,
              ]}
            />
          </View>
          <Text style={[styles.budgetText, entry.budget.over ? styles.budgetOver : null]}>
            {budgetLabel(entry.budget, currency)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    backgroundColor: color.bg.surface,
  },
  row: {
    // A floor rather than a height: the row grows with the font scale (element 11).
    minHeight: ROW_MIN_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: space[2],
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  budget: {
    width: '100%',
    gap: space[1],
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border.hairline,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    backgroundColor: color.text.secondary,
  },
  fillOver: {
    backgroundColor: color.danger.default,
  },
  budgetText: {
    ...type.callout,
    color: color.text.secondary,
    fontVariant: ['tabular-nums'],
  },
  budgetOver: {
    color: color.danger.default,
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space[1],
  },
  separator: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.hairline,
  },
  leading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radius.sm,
  },
  name: {
    ...type.body,
    color: color.text.primary,
    flexShrink: 1,
  },
  figures: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  figuresStacked: {
    // Leading-aligned under the name, and indented past the swatch so the two figures read
    // as belonging to the row above them rather than to the screen edge.
    marginLeft: SWATCH_SIZE + space[3],
    gap: space[3],
  },
  amount: {
    // `type.amountRow` spelt out rather than spread: the token's own `fontVariant` is a
    // readonly tuple, which `TextStyle` will not take, so every money style in this app
    // restates it as a mutable array (`MonthTotal`, `ExpenseRow`).
    ...type.bodyStrong,
    color: color.text.primary,
    fontVariant: ['tabular-nums'],
  },
  percent: {
    ...type.callout,
    color: color.text.tertiary,
    fontVariant: ['tabular-nums'],
    width: PERCENT_WIDTH,
    textAlign: 'right',
  },
});
