import { type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SnackbarProvider, type SnackbarRequest, useSnackbar } from '@/components/Snackbar';
import { a11y } from '@/theme/tokens';
import { SAFE_AREA_METRICS } from '../support/safeArea';

/**
 * The snackbar: `docs/design/00-foundations.md` §6, plus the replacement rule that makes
 * it a provider.
 *
 * Three of these cases are about state the *app* depends on rather than about pixels:
 *
 * - **Replacement.** `04-expense-list.md` rule 9 says deleting a second expense while a
 *   snackbar is showing replaces it and the first delete stands. If two could stack, Undo
 *   would be ambiguous about which delete it reverses.
 * - **The screen-reader window is 10s, not 5s.** A user who has to hear the message
 *   *and* find the action needs the longer window; it is the whole reason the duration is
 *   read asynchronously rather than being a constant.
 * - **Every snackbar is announced.** A confirmation that is only drawn is invisible to the
 *   user most likely to need it.
 *
 * The cases that assert on the auto-dismiss window are quarantined in their own block at
 * the bottom of this file, and that is deliberate. Fake timers also fake the timer React's
 * scheduler commits renders on, so a block that installs them leaks into every case
 * declared after it: renders stop landing and the failure reads as a missing element
 * rather than as a clock problem.
 */

/** Drives the provider from inside, the way a screen does. */
function Trigger({
  requests,
  testID,
}: {
  readonly requests: readonly SnackbarRequest[];
  readonly testID: string;
}) {
  const show = useSnackbar();
  return (
    <>
      {requests.map((request, index) => (
        <Pressable
          key={index}
          testID={`${testID}-${index}`}
          accessibilityRole="button"
          onPress={() => {
            show(request);
          }}
        >
          <Text>show</Text>
        </Pressable>
      ))}
    </>
  );
}

function Wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <SnackbarProvider>{children}</SnackbarProvider>
    </SafeAreaProvider>
  );
}

async function renderWithSnackbars(requests: readonly SnackbarRequest[]): Promise<void> {
  await render(<Trigger requests={requests} testID="show" />, { wrapper: Wrapper });
}

describe('SnackbarProvider', () => {
  let announce: jest.SpiedFunction<typeof AccessibilityInfo.announceForAccessibility>;

  beforeEach(() => {
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows nothing until something asks for one', async () => {
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('shows the message it was given', async () => {
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await userEvent.press(screen.getByTestId('show-0'));

    expect(screen.getByText('Expense deleted.')).toBeTruthy();
  });

  it('announces every snackbar, so it is not visual-only', async () => {
    // §8 rule 7. A snackbar is a confirmation that something happened; a screen-reader
    // user who is not told has no other signal that the delete went through.
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await userEvent.press(screen.getByTestId('show-0'));

    expect(announce).toHaveBeenCalledWith('Expense deleted.');
  });

  it('renders an action when one is offered, and runs it on press', async () => {
    const onPress = jest.fn();
    await renderWithSnackbars([
      { message: 'Expense deleted.', action: { label: 'Undo', onPress } },
    ]);

    await userEvent.press(screen.getByTestId('show-0'));
    await userEvent.press(screen.getByTestId('snackbar-action'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders no action when none is offered', async () => {
    await renderWithSnackbars([{ message: 'Changes saved.' }]);

    await userEvent.press(screen.getByTestId('show-0'));

    expect(screen.queryByTestId('snackbar-action')).toBeNull();
  });

  it('lets an action show its own snackbar, which survives the dismiss of the one it replaces', async () => {
    // Undo's own confirmation is `Expense restored.`, and it is shown from inside the
    // handler of the snackbar being dismissed. The host dismisses before invoking the
    // action for exactly this reason: if the order were reversed, the dismiss would land
    // on the replacement and the user's Undo would silently lose its confirmation.
    await renderWithSnackbars([
      { message: 'Expense deleted.', action: { label: 'Undo', onPress: () => undefined } },
      { message: 'Expense restored.' },
    ]);

    await userEvent.press(screen.getByTestId('show-0'));
    await userEvent.press(screen.getByTestId('snackbar-action'));
    await userEvent.press(screen.getByTestId('show-1'));

    expect(screen.getAllByTestId('snackbar')).toHaveLength(1);
    expect(screen.getByText('Expense restored.')).toBeTruthy();
  });

  it('replaces the current snackbar rather than stacking a second', async () => {
    // `04-expense-list.md` rule 9: the first delete stands, and Undo refers to the
    // snackbar that is visible. Two on screen would make "the most recent delete"
    // something the user has to work out.
    await renderWithSnackbars([{ message: 'Expense deleted.' }, { message: 'Changes saved.' }]);

    await userEvent.press(screen.getByTestId('show-0'));
    await userEvent.press(screen.getByTestId('show-1'));

    expect(screen.getAllByTestId('snackbar')).toHaveLength(1);
    expect(screen.getByText('Changes saved.')).toBeTruthy();
    expect(screen.queryByText('Expense deleted.')).toBeNull();
  });

  it('is not a live region, because it was already announced on show', async () => {
    // Both would fire, and the user would hear the message twice.
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await userEvent.press(screen.getByTestId('show-0'));

    expect(screen.getByTestId('snackbar').props.accessibilityLiveRegion).toBe('none');
  });
});

describe('useSnackbar outside a provider', () => {
  it('is a no-op rather than a throw', async () => {
    // A snackbar confirms something that has *already* been committed to SQLite. A
    // missing provider must not be able to turn a completed save into a crash.
    const show = jest.fn();

    function Bare() {
      const snackbar = useSnackbar();
      show.mockImplementation(snackbar);
      return null;
    }

    await render(<Bare />);

    expect(() => {
      show({ message: 'Expense deleted.' });
    }).not.toThrow();
  });
});

describe('the visible window', () => {
  let screenReader: jest.SpiedFunction<typeof AccessibilityInfo.isScreenReaderEnabled>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    screenReader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  });

  afterEach(() => {
    // Cleared rather than run: a pending dismiss fired here would land on a tree RNTL
    // has not unmounted yet, updating state outside `act`.
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * Press a control and flush the re-render.
   *
   * `fireEvent` under an explicit `act` rather than `userEvent`, whose own internal
   * delays never resolve against a clock the test is advancing by hand.
   */
  async function press(testID: string): Promise<void> {
    await act(async () => {
      fireEvent.press(screen.getByTestId(testID));
    });
  }

  /**
   * Advance the clock, letting everything each timer starts settle.
   *
   * The async variant throughout: the host reads `isScreenReaderEnabled()` and sets the
   * duration in a `.then`, so the chain that *schedules* the dismiss is several
   * microtasks deep. A synchronous advance would run the clock past the window before a
   * timer had been scheduled at all, and the snackbar would never dismiss.
   */
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  it('auto-dismisses after 5s', async () => {
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await press('show-0');

    await advance(a11y.snackbarMs - 1);
    expect(screen.queryByTestId('snackbar')).not.toBeNull();

    await advance(1);
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('holds for 10s when a screen reader is on', async () => {
    // §8 rule 9. The action has to be *heard* and then *reached*, and 5s is not enough
    // for both.
    screenReader.mockResolvedValue(true);
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await press('show-0');

    await advance(a11y.snackbarMs);
    expect(screen.queryByTestId('snackbar')).not.toBeNull();

    await advance(a11y.snackbarScreenReaderMs - a11y.snackbarMs);
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('does not start the timer before the screen-reader answer is in', async () => {
    // Starting at 5s and extending later would clip a screen-reader user's window
    // whenever the read resolved slowly, which is exactly when it matters.
    let resolve: (enabled: boolean) => void = () => undefined;
    screenReader.mockReturnValue(
      new Promise<boolean>((settle) => {
        resolve = settle;
      }),
    );
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await press('show-0');
    await advance(a11y.snackbarScreenReaderMs * 2);
    expect(screen.queryByTestId('snackbar')).not.toBeNull();

    await act(async () => {
      resolve(false);
    });
    await advance(a11y.snackbarMs);
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('falls back to 5s when the screen-reader read fails', async () => {
    screenReader.mockRejectedValue(new Error('no accessibility manager'));
    await renderWithSnackbars([{ message: 'Expense deleted.' }]);

    await press('show-0');

    await advance(a11y.snackbarMs);
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });

  it('restarts the window when the same message is shown twice', async () => {
    // Two deletes in a row produce two identical messages. Without a token to tell them
    // apart the second would inherit the first one's nearly-expired timer, so the Undo
    // window for the second delete would be whatever was left of the first.
    await renderWithSnackbars([{ message: 'Expense deleted.' }, { message: 'Expense deleted.' }]);

    await press('show-0');
    await advance(a11y.snackbarMs - 500);
    await press('show-1');

    await advance(a11y.snackbarMs - 500);
    expect(screen.queryByTestId('snackbar')).not.toBeNull();

    await advance(500);
    expect(screen.queryByTestId('snackbar')).toBeNull();
  });
});
