import type { ReactNode } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MonthProvider } from '@/month/MonthProvider';
import {
  MONTH_LABEL_TEST_ID,
  MONTH_NEXT_TEST_ID,
  MONTH_PREVIOUS_TEST_ID,
  MonthSwitcher,
} from '@/month/MonthSwitcher';
import { SnackbarProvider } from '@/components/Snackbar';
import { SNACK_COPY } from '@/copy/strings';
import { SAFE_AREA_METRICS } from '../support/safeArea';

/**
 * The month switcher bar: `docs/design/05-month-switcher.md` §The bar.
 *
 * Mounted over the real {@link MonthProvider} and the real {@link SnackbarProvider}, so
 * what is asserted is the month the user ends up on rather than a callback having fired.
 * The provider is where rule 2's clamp lives, so a bar tested against a spy could pass
 * while walking the user into 2027.
 */

/** 14 October 2026. Local components, so the suite's timezone cannot move the day. */
const NOW = new Date(2026, 9, 14, 9, 0, 0);

const onOpenPicker = jest.fn();

async function mountBar(): Promise<void> {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      // The snackbar the disabled Next arrow raises positions itself above the bottom
      // inset, so it needs real metrics to render at all.
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <SnackbarProvider>
          <MonthProvider clock={() => NOW}>{children}</MonthProvider>
        </SnackbarProvider>
      </SafeAreaProvider>
    );
  }

  await render(<MonthSwitcher onOpenPicker={onOpenPicker} />, { wrapper: Wrapper });
}

function label(): string {
  return screen.getByTestId(MONTH_LABEL_TEST_ID).props.accessibilityLabel as string;
}

beforeEach(() => {
  onOpenPicker.mockClear();
});

describe('MonthSwitcher', () => {
  it('names the month in view', async () => {
    await mountBar();

    // `MMMM yyyy` from `Intl`, per rule 12.
    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('steps back a month, and the label follows', async () => {
    await mountBar();

    await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

    expect(screen.getByText('September 2026')).toBeTruthy();
  });

  it('steps forward again once there is a month to step forward to', async () => {
    await mountBar();
    await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

    await userEvent.press(screen.getByTestId(MONTH_NEXT_TEST_ID));

    expect(screen.getByText('October 2026')).toBeTruthy();
  });

  it('opens the picker from the centre label', async () => {
    // Rule 4: the label is the only path to a non-adjacent month.
    await mountBar();

    await userEvent.press(screen.getByTestId(MONTH_LABEL_TEST_ID));

    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  describe('the edge of the future', () => {
    it('does not move past the current month', async () => {
      await mountBar();

      await userEvent.press(screen.getByTestId(MONTH_NEXT_TEST_ID));

      expect(screen.getByText('October 2026')).toBeTruthy();
      expect(screen.queryByText('November 2026')).toBeNull();
    });

    it('says why, rather than doing nothing silently', async () => {
      // Rule 2. A disabled control needs a stated reason, and a 48-tall bar has no room
      // for helper text - so the reason arrives as a snackbar on the tap. A `disabled`
      // Pressable would swallow the press and leave the user guessing.
      await mountBar();

      await userEvent.press(screen.getByTestId(MONTH_NEXT_TEST_ID));

      expect(screen.getByText(SNACK_COPY.month.current)).toBeTruthy();
    });

    it('still announces Next as unavailable', async () => {
      await mountBar();

      expect(screen.getByTestId(MONTH_NEXT_TEST_ID).props.accessibilityState).toEqual({
        disabled: true,
      });
    });

    it('announces Next as available once the month is in the past', async () => {
      await mountBar();

      await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

      expect(screen.getByTestId(MONTH_NEXT_TEST_ID).props.accessibilityState).toEqual({
        disabled: false,
      });
    });
  });

  describe('what the arrows are called', () => {
    it('names the destination rather than the direction', async () => {
      // §Accessibility rule 2: "`Previous month, September 2026` tells a screen-reader
      // user where they are going. `Previous` alone does not."
      await mountBar();

      expect(screen.getByLabelText('Previous month, September 2026')).toBeTruthy();
      expect(screen.getByLabelText('Next month, November 2026')).toBeTruthy();
    });

    it('re-points both labels after a step', async () => {
      // The bug this guards is a label computed once: after stepping to September, Previous
      // must offer August, not September again.
      await mountBar();

      await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));

      expect(screen.getByLabelText('Previous month, August 2026')).toBeTruthy();
      expect(screen.getByLabelText('Next month, October 2026')).toBeTruthy();
    });

    it('carries the year across a January boundary', async () => {
      await mountBar();
      for (let index = 0; index < 9; index += 1) {
        await userEvent.press(screen.getByTestId(MONTH_PREVIOUS_TEST_ID));
      }

      expect(screen.getByText('January 2026')).toBeTruthy();
      expect(screen.getByLabelText('Previous month, December 2025')).toBeTruthy();
    });
  });

  it('labels the centre as a button that jumps somewhere', async () => {
    await mountBar();

    expect(label()).toBe('October 2026');
    expect(screen.getByTestId(MONTH_LABEL_TEST_ID).props.accessibilityHint).toBe(
      'Double tap to jump to another month.',
    );
  });

  it('does not truncate the month label at any font scale', async () => {
    // §Accessibility rule 6: the bar grows taller rather than truncating `October 2026`.
    // `numberOfLines` on this text is what would break that, so its absence is the assertion.
    await mountBar();

    expect(screen.getByText('October 2026').props.numberOfLines).toBeUndefined();
  });
});
