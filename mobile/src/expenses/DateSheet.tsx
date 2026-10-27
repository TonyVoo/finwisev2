import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import {
  type CalendarDate,
  calendarDate,
  dateParts,
  daysInMonth,
  isFutureDate,
  monthKey,
  monthKeyOf,
  monthLabel,
  spokenDate,
  stepDay,
  stepMonth,
  weekdayIndex,
  weekdayInitials,
} from '../lib/calendar';
import { HIT_SLOP_44, color, radius, size, space, type } from '../theme/tokens';

/**
 * The date sheet: `docs/design/06-expense-form.md` rule 7.
 *
 * Two quick options and a calendar. "Most expenses are entered the day they happen or the
 * day after", so `Today` and `Yesterday` cover the common case without opening a grid at
 * all; `Choose a date…` reveals one for everything else.
 *
 * ### The rule this screen exists to not get wrong
 *
 * > The selected date is stored as a `YYYY-MM-DD` string **built from the picker's local
 * > year/month/day components directly**. It must never be produced via `toISOString()`,
 * > which converts to UTC and shifts the date by a day for any user west of Greenwich in
 * > the evening. This is the single most likely date bug in this app.
 *
 * Every date here is a `YYYY-MM-DD` string from end to end. The grid is built from
 * `daysInMonth` and `calendarDate`, both of which work on integers and strings, so there
 * is no instant anywhere to convert and nothing for a timezone to shift.
 *
 * ### A deviation from the spec, deliberately flagged
 *
 * Rule 7 names `@react-native-community/datetimepicker` in `inline` display. That package
 * is not a dependency of this app and adding it would introduce a native module this task
 * cannot build or verify. The grid below is written against the existing calendar helpers
 * instead: it honours the same bound (`maximumDate` is today - rule 9), has no lower bound
 * (matching `05-month-switcher.md` rule 3), and is fully exercised under jest. **Raised on
 * `TVO-11` for the Designer**, since swapping it for the platform picker later is a change
 * behind this component's props rather than through the form.
 */

export const DATE_SHEET_TEST_ID = 'date-sheet';
export const DATE_TODAY_TEST_ID = 'date-today';
export const DATE_YESTERDAY_TEST_ID = 'date-yesterday';
export const DATE_CHOOSE_TEST_ID = 'date-choose';
export const DATE_GRID_TEST_ID = 'date-grid';

export interface DateSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly selected: CalendarDate;
  readonly today: CalendarDate;
  readonly onSelect: (date: CalendarDate) => void;
  /**
   * Reuse for dates that may lie ahead (a recurring rule's start and end). Off by default:
   * an expense that has not happened yet is a budget (rule 9), so the expense form keeps
   * refusing the future.
   */
  readonly allowFuture?: boolean;
  /** Earliest pickable date, inclusive. None by default (`05-month-switcher.md` rule 3). */
  readonly minimum?: CalendarDate;
  /** Sheet heading. Defaults to the expense form's `Date`. */
  readonly title?: string;
  /** Show `Today` and `Yesterday` above the grid. On by default. */
  readonly quickOptions?: boolean;
  /** An extra first row that clears the value, e.g. `Never` for an optional end date. */
  readonly clearOption?: { readonly label: string; readonly onPress: () => void };
}

export function DateSheet({
  visible,
  onClose,
  selected,
  today,
  onSelect,
  allowFuture = false,
  minimum,
  title,
  quickOptions = true,
  clearOption,
}: DateSheetProps) {
  const [showGrid, setShowGrid] = useState(false);
  // The month the grid is looking at, which starts on the selected date's month.
  const [gridMonth, setGridMonth] = useState(() => monthKeyOf(selected));

  // Closed means the next opening starts from the quick options again, not on a grid left
  // open (and left on another month) by the last use.
  useEffect(() => {
    if (!visible) setShowGrid(false);
  }, [visible]);

  const yesterday = stepDay(today, -1);

  return (
    <Sheet
      visible={visible}
      title={title ?? COPY.form.field.date}
      onClose={onClose}
      testID={DATE_SHEET_TEST_ID}
    >
      {clearOption === undefined ? null : (
        <Row
          testID="date-clear"
          onPress={clearOption.onPress}
          accessibilityLabel={clearOption.label}
          accessibilityState={{ selected: false }}
        >
          <RowTitle>{clearOption.label}</RowTitle>
        </Row>
      )}

      {quickOptions ? (
        <>
          <Row
            testID={DATE_TODAY_TEST_ID}
            onPress={() => onSelect(today)}
            accessibilityLabel={`${COPY.form.date.today}, ${spokenDate(today)}`}
            accessibilityState={{ selected: selected === today }}
          >
            <RowTitle>{COPY.form.date.today}</RowTitle>
          </Row>

          <Row
            testID={DATE_YESTERDAY_TEST_ID}
            onPress={() => onSelect(yesterday)}
            accessibilityLabel={`${COPY.form.date.yesterday}, ${spokenDate(yesterday)}`}
            accessibilityState={{ selected: selected === yesterday }}
          >
            <RowTitle>{COPY.form.date.yesterday}</RowTitle>
          </Row>
        </>
      ) : null}

      <Row
        testID={DATE_CHOOSE_TEST_ID}
        onPress={() => {
          // Re-anchored each time it opens, so reopening after picking August does not
          // leave the grid on whatever month it was last scrolled to.
          setGridMonth(monthKeyOf(selected));
          setShowGrid(true);
        }}
        chevron={!showGrid}
        lastInGroup
        accessibilityLabel={COPY.form.date.choose}
        accessibilityState={{ selected: showGrid }}
      >
        <RowTitle>{COPY.form.date.choose}</RowTitle>
      </Row>

      {showGrid ? (
        <DayGrid
          month={gridMonth}
          selected={selected}
          today={today}
          allowFuture={allowFuture}
          minimum={minimum}
          onChangeMonth={setGridMonth}
          onSelect={onSelect}
        />
      ) : null}
    </Sheet>
  );
}

function DayGrid({
  month,
  selected,
  today,
  allowFuture,
  minimum,
  onChangeMonth,
  onSelect,
}: {
  readonly month: string;
  readonly selected: CalendarDate;
  readonly today: CalendarDate;
  readonly allowFuture: boolean;
  readonly minimum: CalendarDate | undefined;
  readonly onChangeMonth: (next: string) => void;
  readonly onSelect: (date: CalendarDate) => void;
}) {
  const { year, month: monthNumber } = { ...dateParts(`${month}-01`) };
  const days = daysInMonth(month);
  // No lower bound (rule 9), and no month beyond the one today falls in: every future day
  // is refused anyway, so a month of nothing but disabled cells is a dead end.
  const canGoNext = allowFuture || monthKey(year, monthNumber) < monthKeyOf(today);
  const canGoPrevious = minimum === undefined || monthKey(year, monthNumber) > monthKeyOf(minimum);

  return (
    <View testID={DATE_GRID_TEST_ID} style={styles.grid}>
      <View style={styles.gridHeader}>
        <Pressable
          testID="date-grid-previous"
          onPress={canGoPrevious ? () => onChangeMonth(stepMonth(month, -1)) : undefined}
          disabled={!canGoPrevious}
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          accessibilityLabel={`Previous month, ${monthLabel(stepMonth(month, -1))}`}
          accessibilityState={{ disabled: !canGoPrevious }}
          style={styles.gridArrow}
        >
          <Feather
            name="chevron-left"
            size={20}
            color={canGoPrevious ? color.text.primary : color.text.disabled}
          />
        </Pressable>

        <Text style={styles.gridMonth} accessibilityRole="header">
          {monthLabel(month)}
        </Text>

        <Pressable
          testID="date-grid-next"
          onPress={canGoNext ? () => onChangeMonth(stepMonth(month, 1)) : undefined}
          disabled={!canGoNext}
          hitSlop={HIT_SLOP_44}
          accessibilityRole="button"
          accessibilityLabel={`Next month, ${monthLabel(stepMonth(month, 1))}`}
          accessibilityState={{ disabled: !canGoNext }}
          style={styles.gridArrow}
        >
          <Feather
            name="chevron-right"
            size={20}
            color={canGoNext ? color.text.primary : color.text.disabled}
          />
        </Pressable>
      </View>

      {/* Decorative: every day button already carries its full spoken date. */}
      <View
        style={styles.days}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {weekdayInitials().map((initial, index) => (
          <View key={index} style={styles.weekday}>
            <Text style={styles.weekdayLabel}>{initial}</Text>
          </View>
        ))}
      </View>

      <View style={styles.days}>
        {/* Blank cells push day 1 under its weekday. */}
        {Array.from({ length: weekdayIndex(calendarDate(year, monthNumber, 1)) }, (_unused, i) => (
          <View key={`blank-${i}`} style={styles.day} />
        ))}
        {Array.from({ length: days }, (_unused, index) => {
          const date = calendarDate(year, monthNumber, index + 1);
          // Rule 9: a date in the future is rejected. "An expense that has not happened
          // yet is a budget", which is explicitly out of scope.
          const future =
            (!allowFuture && isFutureDate(date, today)) ||
            (minimum !== undefined && date < minimum);
          const isSelected = date === selected;

          return (
            <Pressable
              key={date}
              testID={`date-day-${date}`}
              onPress={future ? undefined : () => onSelect(date)}
              disabled={future}
              accessibilityRole="button"
              accessibilityLabel={spokenDate(date)}
              accessibilityState={{ selected: isSelected, disabled: future }}
              style={[
                styles.day,
                styles.dayFilled,
                isSelected ? styles.daySelected : null,
                future ? styles.dayDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.dayLabel,
                  isSelected ? styles.dayLabelSelected : null,
                  future ? styles.dayLabelDisabled : null,
                ]}
              >
                {index + 1}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    paddingTop: space[4],
    gap: space[3],
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gridArrow: {
    minWidth: size.tapTargetMin,
    minHeight: size.tapTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridMonth: {
    ...type.headline,
    color: color.text.primary,
    flex: 1,
    textAlign: 'center',
  },
  days: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[1],
  },
  day: {
    // A seventh of the row, less the gaps, so the grid lays out as weeks-wide columns
    // without having to know the width.
    width: '13%',
    minHeight: size.tapTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  dayFilled: { backgroundColor: color.bg.surface },
  weekday: { width: '13%', alignItems: 'center' },
  weekdayLabel: { ...type.caption, color: color.text.tertiary },
  daySelected: {
    backgroundColor: color.primary.default,
  },
  dayDisabled: {
    backgroundColor: color.bg.sunken,
  },
  dayLabel: {
    ...type.body,
    color: color.text.primary,
    fontVariant: ['tabular-nums'],
  },
  dayLabelSelected: {
    color: color.text.inverse,
    fontWeight: '600',
  },
  dayLabelDisabled: {
    color: color.text.disabled,
  },
});
