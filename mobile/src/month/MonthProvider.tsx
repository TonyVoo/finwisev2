import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { type Clock, systemClock } from '../lib/clock';
import {
  type CalendarDate,
  type MonthKey,
  currentMonthKey,
  isFutureMonth,
  stepMonth,
  todayCalendarDate,
} from '../lib/calendar';

/**
 * The month both tab screens are looking at.
 *
 * `docs/design/05-month-switcher.md` rule 7 calls this "the single most important rule
 * here": the month is **app state, not per-screen state**. Home and Summary must never be
 * able to show different months, because both of them label their figure "Total this
 * month" - two tabs disagreeing about which month that is would make one of the totals
 * look simply wrong, with nothing on either screen to explain it. So the selection lives
 * above the tabs and each screen reads it.
 *
 * **It is session state and is not persisted** (rule 8). A cold start lands on today
 * rather than on wherever the user was last week: having read about August 2025 yesterday
 * is not a reason to open the app in August 2025 today. Within a session, including across
 * backgrounding, the selection holds - which is what a provider gives for free and a
 * persisted value would have to be talked out of.
 */

export interface MonthSelection {
  /** The month in view, `YYYY-MM`. */
  readonly month: MonthKey;
  /** The month today falls in - the upper bound, and what `This month` jumps to. */
  readonly currentMonth: MonthKey;
  /** Today in the device's local calendar, for the day labels the host screens render. */
  readonly today: CalendarDate;
  readonly isCurrent: boolean;
  /** False at the current month: the user cannot navigate into the future (rule 2). */
  readonly canGoNext: boolean;
  /**
   * Select a month. A future month is **ignored**, so no caller can navigate past the
   * current one; rule 2 is enforced here rather than only by the disabled arrow, because
   * the picker grid and a deep link are two more ways to ask for one.
   */
  readonly select: (key: MonthKey) => void;
  /** Step whole calendar months; the year follows (rule 1). Clamped by {@link select}. */
  readonly step: (delta: number) => void;
  readonly goToCurrent: () => void;
}

const MonthContext = createContext<MonthSelection | null>(null);

export interface MonthProviderProps {
  readonly children: ReactNode;
  /** Injectable so a test can pin "today" instead of depending on the day it runs. */
  readonly clock?: Clock;
}

export function MonthProvider({ children, clock = systemClock }: MonthProviderProps) {
  // Read on every render rather than captured once at mount. The value is a stable string
  // for all but one render a day, so nothing downstream thrashes, and it means an app left
  // open across midnight does not go on believing yesterday is the current month - which
  // would leave Next disabled a month early and `This month` pointing at the wrong one.
  // One reading of the clock, not two: `today` and `currentMonth` taken from separate
  // `Date`s could straddle midnight and disagree about which month today is in.
  const now = clock();
  const today = todayCalendarDate(now);
  const currentMonth = currentMonthKey(now);

  const [month, setMonth] = useState<MonthKey>(currentMonth);

  const select = useCallback(
    (key: MonthKey) => {
      if (isFutureMonth(key, today)) return;
      setMonth(key);
    },
    [today],
  );

  const step = useCallback(
    (delta: number) => {
      // Stepping is expressed against the *current* selection rather than a captured one, so
      // two taps in one frame advance two months instead of landing on the same one twice.
      setMonth((previous) => {
        const next = stepMonth(previous, delta);
        return isFutureMonth(next, today) ? previous : next;
      });
    },
    [today],
  );

  const goToCurrent = useCallback(() => {
    setMonth(currentMonth);
  }, [currentMonth]);

  const value = useMemo<MonthSelection>(
    () => ({
      month,
      currentMonth,
      today,
      isCurrent: month === currentMonth,
      canGoNext: !isFutureMonth(stepMonth(month, 1), today),
      select,
      step,
      goToCurrent,
    }),
    [month, currentMonth, today, select, step, goToCurrent],
  );

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>;
}

/**
 * The selected month. Throws outside a provider rather than defaulting to today.
 *
 * A default would let a screen render a month nobody selected and look right while being
 * disconnected from the other tab - exactly the split rule 7 exists to prevent, and it
 * would survive review because the screen would work.
 */
export function useSelectedMonth(): MonthSelection {
  const selection = useContext(MonthContext);
  if (selection === null) {
    throw new Error('useSelectedMonth must be used inside MonthProvider');
  }
  return selection;
}
