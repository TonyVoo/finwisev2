import type { ReactNode } from 'react';
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COPY } from '@/copy/strings';
import { type MonthSelection, useSelectedMonth } from '@/month/MonthProvider';
import { AppProviders } from '@/bootstrap/AppProviders';
import { createAppContainer } from '@/bootstrap/container';
import { migrate } from '@/db/migrations';
import MonthPickerScreen, {
  MONTH_CELL_TEST_ID_PREFIX,
  MONTH_DOT_TEST_ID_PREFIX,
  THIS_MONTH_TEST_ID,
  YEAR_NEXT_TEST_ID,
  YEAR_PREVIOUS_TEST_ID,
} from '../../app/(app)/month-picker';
import { resetRouter, routerRecord } from '../support/router';
import { SAFE_AREA_METRICS } from '../support/safeArea';
import { createTestDatabase } from '../support/sqlite';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * The month picker sheet: `docs/design/05-month-switcher.md` §The picker sheet.
 *
 * Mounted over the **real** `MonthProvider`, with a probe reading the same context the
 * host screens read. That is the thing the sheet is for: the selection it applies has to
 * land in the shared state, and a sheet tested against a spy could pass while writing to
 * state nothing reads (rule 7).
 *
 * The probe reads the context object rather than rendering the switcher bar beside the
 * sheet. A visible `Modal` takes the rest of the tree out of reach of the query helpers,
 * so a bar rendered as a sibling would simply not be findable - and the bar has its own
 * cases in `tests/month/MonthSwitcher.test.tsx` anyway.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const GROCERIES = categoryId(1);

interface Mounted {
  readonly database: ReturnType<typeof createTestDatabase>;
}

/** The selection as the host screens see it, captured on every render. */
let selection: MonthSelection;

function Probe() {
  selection = useSelectedMonth();
  return null;
}

/** The sheet, over a real container, with the probe reading the same provider. */
async function mountPicker(
  seed?: (database: ReturnType<typeof createTestDatabase>) => Promise<void>,
): Promise<Mounted> {
  const database = createTestDatabase();
  await migrate(database);
  if (seed !== undefined) await seed(database);

  const container = await createAppContainer({
    database,
    clock: () => NOW,
    transport: async (request) => {
      throw new Error(`the month picker must not reach the network, but called ${request.path}`);
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <AppProviders container={container}>{children}</AppProviders>
      </SafeAreaProvider>
    );
  }

  await render(
    <>
      <Probe />
      <MonthPickerScreen />
    </>,
    { wrapper: Wrapper },
  );

  return { database };
}

function cell(key: string) {
  return screen.getByTestId(`${MONTH_CELL_TEST_ID_PREFIX}-${key}`);
}

/** Move the selection off the current month, as the switcher bar's Previous arrow does. */
async function stepBack(): Promise<void> {
  await act(async () => {
    selection.step(-1);
  });
}

beforeEach(() => {
  resetRouter();
});

describe('the month picker', () => {
  it('opens on the selected month’s year', async () => {
    await mountPicker();

    expect(screen.getByText(COPY.picker.month.title)).toBeTruthy();
    expect(screen.getByRole('header', { name: '2026' })).toBeTruthy();
  });

  it('renders all twelve months, every year', async () => {
    // Rule 6: future cells are disabled rather than hidden, "so the grid keeps a stable
    // 3x4 shape in every year".
    await mountPicker();

    for (let month = 1; month <= 12; month += 1) {
      expect(cell(`2026-${String(month).padStart(2, '0')}`)).toBeTruthy();
    }
  });

  describe('selecting a month', () => {
    it('applies it and dismisses, with no confirm step', async () => {
      // Rule 5: "the selection *is* the confirmation, and a one-tap action should not cost
      // two." The bar is the evidence that the selection reached the shared state.
      await mountPicker();

      await userEvent.press(cell('2026-07'));

      await waitFor(() => expect(selection.month).toBe('2026-07'));
      expect(routerRecord.back).toBe(1);
    });

    it('marks the selected month as selected, not only by its fill', async () => {
      // §A11y rule 4: carried by `accessibilityState`, because a fill colour is a purely
      // visual cue.
      await mountPicker();

      expect(cell('2026-10').props.accessibilityState).toEqual({
        selected: true,
        disabled: false,
      });
      expect(cell('2026-07').props.accessibilityState).toEqual({
        selected: false,
        disabled: false,
      });
    });

    it('names each cell by month and year', async () => {
      await mountPicker();

      expect(cell('2026-07').props.accessibilityLabel).toBe('July 2026');
    });
  });

  describe('the future', () => {
    it('disables every month beyond the current one', async () => {
      await mountPicker();

      expect(cell('2026-11').props.accessibilityState).toEqual({
        selected: false,
        disabled: true,
      });
      expect(cell('2026-12').props.accessibilityState).toEqual({
        selected: false,
        disabled: true,
      });
    });

    it('does not select a future month that is tapped anyway', async () => {
      await mountPicker();

      await userEvent.press(cell('2026-12'));

      expect(selection.month).toBe('2026-10');
      expect(routerRecord.back).toBe(0);
    });

    it('leaves the current month itself selectable', async () => {
      // The boundary: the current month is not the future.
      await mountPicker();
      await stepBack();

      await userEvent.press(cell('2026-10'));

      await waitFor(() => expect(selection.month).toBe('2026-10'));
    });

    it('disables the whole of a future year', async () => {
      await mountPicker();

      await userEvent.press(screen.getByTestId(YEAR_NEXT_TEST_ID));

      expect(screen.getByRole('header', { name: '2027' })).toBeTruthy();
      expect(cell('2027-01').props.accessibilityState).toEqual({
        selected: false,
        disabled: true,
      });
    });
  });

  describe('the year stepper', () => {
    it('steps back indefinitely, including before the user signed up', async () => {
      // Rule 3: there is no lower bound. Those months are simply empty.
      await mountPicker();

      await userEvent.press(screen.getByTestId(YEAR_PREVIOUS_TEST_ID));
      await userEvent.press(screen.getByTestId(YEAR_PREVIOUS_TEST_ID));

      expect(screen.getByRole('header', { name: '2024' })).toBeTruthy();
      expect(cell('2024-03').props.accessibilityState).toEqual({
        selected: false,
        disabled: false,
      });
    });

    it('selects a month from another year', async () => {
      await mountPicker();
      await userEvent.press(screen.getByTestId(YEAR_PREVIOUS_TEST_ID));

      await userEvent.press(cell('2025-03'));

      await waitFor(() => expect(selection.month).toBe('2025-03'));
    });

    it('names its destination year, not its direction', async () => {
      await mountPicker();

      expect(screen.getByLabelText('Previous year, 2025')).toBeTruthy();
      expect(screen.getByLabelText('Next year, 2027')).toBeTruthy();
    });
  });

  describe('the has-expenses dots', () => {
    it('marks only the months that hold a live expense', async () => {
      // Rule 9's query. The dot is a convenience for finding where data is.
      await mountPicker(async (database) => {
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 100,
          date: '2026-08-11',
        });
        await seedExpense(database, {
          id: expenseId(2),
          categoryId: GROCERIES,
          amountMinor: 200,
          date: '2026-10-02',
        });
      });

      await waitFor(() =>
        expect(
          screen.queryByTestId(`${MONTH_DOT_TEST_ID_PREFIX}-2026-08`, {
            includeHiddenElements: true,
          }),
        ).not.toBeNull(),
      );
      expect(
        screen.queryByTestId(`${MONTH_DOT_TEST_ID_PREFIX}-2026-09`, {
          includeHiddenElements: true,
        }),
      ).toBeNull();
    });

    it('does not mark a month whose only expense is deleted', async () => {
      await mountPicker(async (database) => {
        await seedFallbackCategory(database);
        await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 100,
          date: '2026-08-11',
          deletedAt: '2026-08-12T00:00:00.000Z',
        });
      });

      expect(
        screen.queryByTestId(`${MONTH_DOT_TEST_ID_PREFIX}-2026-08`, {
          includeHiddenElements: true,
        }),
      ).toBeNull();
    });

    it('keeps an undotted month selectable', async () => {
      // Rule 9: "The grid is fully usable before the count query resolves, and an empty
      // month is still selectable. The dot is ... never a gate."
      await mountPicker();

      await userEvent.press(cell('2026-05'));

      await waitFor(() => expect(selection.month).toBe('2026-05'));
    });
  });

  describe('This month', () => {
    it('is hidden while the current month is already selected', async () => {
      // Rule 10: hidden, not disabled - "a no-op button is worse than no button".
      await mountPicker();

      expect(screen.queryByTestId(THIS_MONTH_TEST_ID)).toBeNull();
    });

    it('appears elsewhere, and jumps back', async () => {
      await mountPicker();
      await stepBack();

      await userEvent.press(screen.getByTestId(THIS_MONTH_TEST_ID));

      await waitFor(() => expect(selection.month).toBe('2026-10'));
      expect(routerRecord.back).toBe(1);
    });
  });
});
