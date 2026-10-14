import { Component, type ReactNode } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { MonthProvider, type MonthSelection, useSelectedMonth } from '@/month/MonthProvider';

/**
 * The selected month: `docs/design/05-month-switcher.md` rules 1, 2, 3, 7 and 8.
 *
 * The cases here are about the two rules that are invariants rather than behaviours, and
 * both are invisible on a screenshot:
 *
 * - **The future is unreachable**, by every route and not just by the disabled arrow. The
 *   picker grid and a deep link can both ask for a month, so the clamp lives in the state
 *   rather than in the control (rule 2, rule 6).
 * - **The selection resets on a cold start** but survives a re-render (rule 8). A provider
 *   that quietly persisted it would pass every other case in this file.
 */

/**
 * 14 October 2026, a Wednesday.
 *
 * Built from **local** components rather than parsed from `...Z`. Everything under test
 * here reads the device's local calendar - which is the right answer for "what day is it"
 * and the reason `todayCalendarDate` exists - so an instant pinned in UTC would land on
 * the 13th or the 14th depending on where the suite runs, and these assertions would pass
 * in one timezone and fail in another.
 */
const NOW = new Date(2026, 9, 14, 9, 0, 0);

/**
 * Renders `children` and hands the first render error to `onError` instead of letting it
 * take the tree down. A class component because `componentDidCatch` has no hook form.
 */
class CatchRenderError extends Component<
  { readonly children: ReactNode; readonly onError: (error: Error) => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Orphan() {
  useSelectedMonth();
  return null;
}

let latest: MonthSelection;

function Probe() {
  latest = useSelectedMonth();
  return <Text>{latest.month}</Text>;
}

async function mountProvider(now: Date = NOW): Promise<void> {
  await render(
    <MonthProvider clock={() => now}>
      <Probe />
    </MonthProvider>,
  );
}

/** Drive the selection the way a control would, flushing the re-render. */
async function run(change: (selection: MonthSelection) => void): Promise<void> {
  await act(async () => {
    change(latest);
  });
}

describe('MonthProvider', () => {
  it('starts on the month today falls in', async () => {
    await mountProvider();

    expect(latest.month).toBe('2026-10');
    expect(latest.currentMonth).toBe('2026-10');
    expect(latest.isCurrent).toBe(true);
    expect(latest.today).toBe('2026-10-14');
  });

  describe('stepping', () => {
    it('steps back a month', async () => {
      await mountProvider();

      await run((selection) => selection.step(-1));

      expect(latest.month).toBe('2026-09');
      expect(latest.isCurrent).toBe(false);
    });

    it('carries the year when it steps back past January', async () => {
      // Rule 1. The arithmetic lives in `stepMonth`, but this is the case that proves the
      // provider is using it rather than decrementing the month field.
      await mountProvider(new Date(2026, 0, 10, 9, 0, 0));

      await run((selection) => selection.step(-1));

      expect(latest.month).toBe('2025-12');
    });

    it('steps forward again, back towards the current month', async () => {
      await mountProvider();
      await run((selection) => selection.step(-3));

      await run((selection) => selection.step(1));

      expect(latest.month).toBe('2026-08');
    });

    it('steps back indefinitely, including past the user signing up', async () => {
      // Rule 3: there is no lower bound. A floor computed from the earliest expense would
      // move as data arrives and make the control feel inconsistent.
      await mountProvider();

      for (let index = 0; index < 24; index += 1) {
        await run((selection) => selection.step(-1));
      }

      expect(latest.month).toBe('2024-10');
    });

    it('advances twice for two steps taken in one frame', async () => {
      // The reducer form is what makes this true. Reading `month` from the enclosing
      // render instead would make both taps compute `2026-08` and land there once -
      // a double tap on Previous would move one month.
      await mountProvider();

      await act(async () => {
        latest.step(-1);
        latest.step(-1);
      });

      expect(latest.month).toBe('2026-08');
    });
  });

  describe('the future, which is unreachable by every route', () => {
    it('refuses to step past the current month', async () => {
      await mountProvider();

      await run((selection) => selection.step(1));

      expect(latest.month).toBe('2026-10');
    });

    it('reports that Next is unavailable at the current month', async () => {
      await mountProvider();

      expect(latest.canGoNext).toBe(false);
    });

    it('reports that Next is available anywhere earlier', async () => {
      await mountProvider();

      await run((selection) => selection.step(-1));

      expect(latest.canGoNext).toBe(true);
    });

    it('ignores a future month handed to select', async () => {
      // Rule 6, and the reason the clamp is here and not only on the arrow: the picker
      // grid renders future cells (disabled, so the grid keeps a stable shape) and a deep
      // link carries whatever it carries.
      await mountProvider();

      await run((selection) => selection.select('2027-03'));

      expect(latest.month).toBe('2026-10');
    });

    it('accepts a past month handed to select', async () => {
      await mountProvider();

      await run((selection) => selection.select('2025-02'));

      expect(latest.month).toBe('2025-02');
    });

    it('accepts the current month itself, which is not the future', async () => {
      // The boundary. `>` rather than `>=` is what makes `This month` work at all.
      await mountProvider();
      await run((selection) => selection.select('2025-02'));

      await run((selection) => selection.select('2026-10'));

      expect(latest.month).toBe('2026-10');
    });
  });

  it('jumps back to the current month', async () => {
    await mountProvider();
    await run((selection) => selection.step(-5));

    await run((selection) => selection.goToCurrent());

    expect(latest.month).toBe('2026-10');
    expect(latest.isCurrent).toBe(true);
  });

  it('holds the selection across a re-render', async () => {
    // Rule 8's other half: within a session the selection holds. A value recomputed from
    // the clock on every render would fail this and look fine on screen.
    await mountProvider();
    await run((selection) => selection.select('2026-07'));

    await act(async () => {
      screen.rerender(
        <MonthProvider clock={() => NOW}>
          <Probe />
        </MonthProvider>,
      );
    });

    expect(latest.month).toBe('2026-07');
  });

  it('does not survive a cold start', async () => {
    // Rule 8: the month is session state. "A user who reopens the app after reading about
    // August 2025 expects to land on today."
    //
    // The cold start is staged by changing the provider's `key`, which makes React discard
    // the instance and mount a fresh one - a genuinely new provider, with nothing carried
    // over, inside one render root. Rendering twice in one test would leave a tree mounted
    // that the library's teardown does not own, and the damage shows up in the next test
    // rather than this one.
    await render(
      <MonthProvider key="first-launch" clock={() => NOW}>
        <Probe />
      </MonthProvider>,
    );
    await run((selection) => selection.select('2025-08'));
    expect(latest.month).toBe('2025-08');

    await act(async () => {
      screen.rerender(
        <MonthProvider key="second-launch" clock={() => NOW}>
          <Probe />
        </MonthProvider>,
      );
    });

    expect(latest.month).toBe('2026-10');
  });

  it('refuses to render a month nobody selected', async () => {
    // A default outside the provider would let a screen look correct while being
    // disconnected from the other tab - the exact split rule 7 exists to prevent, and it
    // would survive review because the screen would work.
    //
    // React logs the thrown render error; silenced so the suite output stays readable.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Caught through an error boundary rather than by `expect(...).toThrow`: React 19
    // reports a render error to the nearest boundary instead of rethrowing out of
    // `render`, so a bare `toThrow` sees nothing and passes whatever the hook does.
    let caught: Error | null = null;
    await render(
      <CatchRenderError onError={(error) => (caught = error)}>
        <Orphan />
      </CatchRenderError>,
    );

    expect(caught).not.toBeNull();
    expect((caught as unknown as Error).message).toMatch(/MonthProvider/);

    consoleError.mockRestore();
  });

  it('keeps today current when the app is left open past midnight', async () => {
    // `today` is derived from the clock on each render rather than captured at mount, so a
    // phone left on the list overnight does not go on believing yesterday is the current
    // month - which would leave Next disabled a month early on the 1st.
    let now = new Date(2026, 9, 31, 23, 59, 0);
    function Host({ children }: { readonly children: ReactNode }) {
      return <MonthProvider clock={() => now}>{children}</MonthProvider>;
    }

    await render(
      <Host>
        <Probe />
      </Host>,
    );
    expect(latest.currentMonth).toBe('2026-10');

    now = new Date(2026, 10, 1, 0, 1, 0);
    await act(async () => {
      screen.rerender(
        <Host>
          <Probe />
        </Host>,
      );
    });

    expect(latest.currentMonth).toBe('2026-11');
    // October is now the past, so Next opens up - without the user touching anything.
    expect(latest.canGoNext).toBe(true);
  });
});
