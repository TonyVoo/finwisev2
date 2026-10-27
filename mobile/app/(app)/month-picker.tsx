import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { COPY } from '@/copy/strings';
import { useMonthsWithExpenses } from '@/db/hooks';
import {
  isFutureMonth,
  monthKey,
  monthParts,
  monthShortLabel,
  monthSpokenLabel,
} from '@/lib/calendar';
import { useSelectedMonth } from '@/month/MonthProvider';
import { HIT_SLOP_44, radius, size, space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';

/**
 * The month picker: `docs/design/05-month-switcher.md` §The picker sheet.
 *
 * Presented modally from the switcher's centre label, which is the only path to a
 * non-adjacent month (rule 4).
 *
 * ### The two rules that shape the grid
 *
 * **Selecting a cell applies it and dismisses immediately** (rule 5). There is no confirm
 * button, because "the selection *is* the confirmation, and a one-tap action should not
 * cost two."
 *
 * **Future cells are visibly disabled rather than hidden** (rule 6), so the grid keeps a
 * stable 3x4 shape in every year. A grid that grew and shrank as the user stepped through
 * years would make the control feel unreliable for no gain.
 *
 * ### The dots are additive, never a gate
 *
 * The "has expenses" dot comes from one local `GROUP BY`, and the grid is **fully usable
 * before it resolves**: cells render in their default state and an empty month is still
 * selectable (rule 9). The dot helps a user find where their data is; it never decides
 * what they may tap. There is therefore no loading state here at all - the month label and
 * the boundaries are computed, not fetched (§States, `loading`).
 */

export const MONTH_CELL_TEST_ID_PREFIX = 'month-cell';
export const MONTH_DOT_TEST_ID_PREFIX = 'month-dot';
export const YEAR_PREVIOUS_TEST_ID = 'year-previous';
export const YEAR_NEXT_TEST_ID = 'year-next';
export const THIS_MONTH_TEST_ID = 'month-this-month';

/** Above this font scale the grid drops from three columns to two (§A11y rule 6). */
const TWO_COLUMN_FONT_SCALE = 1.5;

export default function MonthPickerScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const { month, currentMonth, today, isCurrent, select, goToCurrent } = useSelectedMonth();
  const monthsWithExpenses = useMonthsWithExpenses();
  const { fontScale } = useWindowDimensions();

  const [year, setYear] = useState(() => monthParts(month).year);

  const withExpenses = new Set(monthsWithExpenses.data ?? []);
  const columns = fontScale > TWO_COLUMN_FONT_SCALE ? 2 : 3;

  const close = () => router.back();

  const apply = (key: string) => {
    select(key);
    close();
  };

  return (
    <Sheet visible title={COPY.picker.month.title} onClose={close} testID="month-picker">
      <View style={styles.yearStepper}>
        <Pressable
          testID={YEAR_PREVIOUS_TEST_ID}
          onPress={() => setYear((current) => current - 1)}
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          // Names the destination, not the direction (§A11y rule 2).
          accessibilityLabel={COPY.a11y.previousYear.replace('{year}', String(year - 1))}
          style={styles.yearArrow}
        >
          <Feather name="chevron-left" size={20} color={color.text.primary} />
        </Pressable>

        <Text style={styles.yearLabel} accessibilityRole="header">
          {year}
        </Text>

        <Pressable
          testID={YEAR_NEXT_TEST_ID}
          onPress={() => setYear((current) => current + 1)}
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          accessibilityLabel={COPY.a11y.nextYear.replace('{year}', String(year + 1))}
          style={styles.yearArrow}
        >
          <Feather name="chevron-right" size={20} color={color.text.primary} />
        </Pressable>
      </View>

      <View style={styles.grid}>
        {Array.from({ length: 12 }, (_unused, index) => {
          const key = monthKey(year, index + 1);
          const future = isFutureMonth(key, today);

          return (
            <MonthCell
              key={key}
              monthKeyValue={key}
              columns={columns}
              selected={key === month}
              isCurrentMonth={key === currentMonth}
              hasExpenses={withExpenses.has(key)}
              future={future}
              onPress={() => apply(key)}
            />
          );
        })}
      </View>

      {/* Hidden - not disabled - when the current month is already selected, "since a
          no-op button is worse than no button" (rule 10). */}
      {isCurrent ? null : (
        <Button
          testID={THIS_MONTH_TEST_ID}
          label={COPY.picker.month.thisMonth}
          variant="ghost"
          fullWidth
          onPress={() => {
            goToCurrent();
            close();
          }}
        />
      )}
    </Sheet>
  );
}

function MonthCell({
  monthKeyValue,
  columns,
  selected,
  isCurrentMonth,
  hasExpenses,
  future,
  onPress,
}: {
  readonly monthKeyValue: string;
  readonly columns: number;
  readonly selected: boolean;
  readonly isCurrentMonth: boolean;
  readonly hasExpenses: boolean;
  readonly future: boolean;
  readonly onPress: () => void;
}) {
  const styles = useStyles();
  // The precedence between the five cell states (§Month cell states). Selected wins over
  // current, because the user's choice is what the screen is about; future wins over
  // everything, because it cannot be chosen at all.
  const fill = future
    ? styles.cellFuture
    : selected
      ? styles.cellSelected
      : isCurrentMonth
        ? styles.cellCurrent
        : styles.cellDefault;

  const label = future
    ? styles.labelFuture
    : selected
      ? styles.labelSelected
      : isCurrentMonth
        ? styles.labelCurrent
        : styles.labelDefault;

  return (
    <Pressable
      testID={`${MONTH_CELL_TEST_ID_PREFIX}-${monthKeyValue}`}
      onPress={future ? undefined : onPress}
      disabled={future}
      accessibilityRole="button"
      accessibilityLabel={monthSpokenLabel(monthKeyValue)}
      // Selection carried as state, not only by the fill colour (§A11y rule 4).
      accessibilityState={{ selected, disabled: future }}
      style={[styles.cell, { width: `${100 / columns - 2}%` }, fill]}
    >
      <Text style={[styles.cellLabel, label]}>{monthShortLabel(monthKeyValue)}</Text>
      {/* Additive: a missing dot never blocks selection, and an empty month is still
          selectable (rule 9). Decorative, because the cell's label already names the
          month and the dot says nothing a screen reader can act on. */}
      {hasExpenses && !future ? (
        <View
          testID={`${MONTH_DOT_TEST_ID_PREFIX}-${monthKeyValue}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.dot, selected ? styles.dotOnSelected : null]}
        />
      ) : null}
    </Pressable>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    yearStepper: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: size.tapTargetMin,
    },
    yearArrow: {
      minWidth: size.tapTargetMin,
      minHeight: size.tapTargetMin,
      alignItems: 'center',
      justifyContent: 'center',
    },
    yearLabel: {
      ...type.headline,
      color: color.text.primary,
      flex: 1,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space[2],
      paddingVertical: space[4],
    },
    cell: {
      // A floor: the cell grows with the font scale rather than clipping `Oct`.
      minHeight: 48,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[1],
    },
    cellDefault: {
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    cellSelected: {
      backgroundColor: color.primary.default,
    },
    cellCurrent: {
      backgroundColor: color.primary.subtle,
      borderWidth: 1,
      borderColor: color.primary.default,
    },
    cellFuture: {
      backgroundColor: color.bg.sunken,
    },
    cellLabel: {
      ...type.subhead,
    },
    labelDefault: {
      color: color.text.primary,
    },
    labelSelected: {
      color: color.text.inverse,
      fontWeight: '600',
    },
    labelCurrent: {
      color: color.primary.default,
      fontWeight: '600',
    },
    labelFuture: {
      color: color.text.disabled,
    },
    dot: {
      width: 4,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: color.primary.default,
    },
    dotOnSelected: {
      // On a `primary.default` fill the dot would be invisible in its own colour.
      backgroundColor: color.text.inverse,
    },
  }),
);
