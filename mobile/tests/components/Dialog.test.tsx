import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { Dialog } from '@/components/Dialog';
import { COPY } from '@/copy/strings';

/**
 * The dialog: `docs/design/00-foundations.md` §6.
 *
 * Every case here is about a path the user did not deliberately take. The dialog only
 * ever guards a destructive action — deleting an expense, deleting a category — so the
 * question that matters is not whether the buttons work but whether *every* ambiguous
 * exit resolves as Cancel. A scrim tap or an Android back that fell through to the
 * destructive action would delete the user's data on a gesture that means "never mind",
 * and nothing on screen would say it had happened.
 */

interface RenderedDialog {
  readonly destructive: { readonly label: string; readonly onPress: jest.Mock };
  readonly onCancel: jest.Mock;
}

async function renderDialog(
  overrides: Partial<Parameters<typeof Dialog>[0]> = {},
): Promise<RenderedDialog> {
  const destructive = { label: 'Delete', onPress: jest.fn() };
  const onCancel = jest.fn();

  await render(
    <Dialog
      visible
      title="Delete this expense?"
      body="This cannot be undone."
      destructive={destructive}
      onCancel={onCancel}
      testID="dialog"
      {...overrides}
    />,
  );

  return { destructive, onCancel };
}

/**
 * The `Modal` the dialog renders into, which is what Android's back button dispatches
 * `requestClose` to. It is the outermost element of this tree, so it is the root.
 */
function modalHost() {
  const root = screen.root;
  if (!root) throw new Error('expected the visible dialog to have rendered a root element');
  return root;
}

describe('Dialog', () => {
  it('renders the title as a heading, with its body', async () => {
    await renderDialog();

    expect(screen.getByRole('header', { name: 'Delete this expense?' })).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('renders without a body, for a question that needs no elaboration', async () => {
    await renderDialog({ body: undefined });

    expect(screen.getByRole('header', { name: 'Delete this expense?' })).toBeTruthy();
    expect(screen.queryByText('This cannot be undone.')).toBeNull();
  });

  it('shows nothing while it is not visible', async () => {
    await renderDialog({ visible: false });

    expect(screen.queryByRole('header', { name: 'Delete this expense?' })).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('puts the destructive action above Cancel, in that order', async () => {
    // §6 states the order, and the props are named `destructive`/`onCancel` rather than
    // primary/secondary so a caller cannot reverse it. This pins the rendering too: the
    // muscle-memory tap lands on the same button every time only if the order is fixed.
    await renderDialog();

    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Delete',
      'Cancel',
    ]);
  });

  it('labels Cancel from the copy deck unless told otherwise', async () => {
    await renderDialog();

    expect(screen.getByRole('button', { name: COPY.common.cancel })).toBeTruthy();
  });

  it('takes a custom cancel label, for a dialog where "Cancel" is the wrong word', async () => {
    await renderDialog({ cancelLabel: 'Keep editing' });

    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeTruthy();
  });

  it('runs the destructive action when it is chosen deliberately', async () => {
    const { destructive } = await renderDialog();

    await userEvent.press(screen.getByTestId('dialog-confirm'));

    expect(destructive.onPress).toHaveBeenCalledTimes(1);
  });

  it('cancels when Cancel is pressed', async () => {
    const { destructive, onCancel } = await renderDialog();

    await userEvent.press(screen.getByTestId('dialog-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(destructive.onPress).not.toHaveBeenCalled();
  });

  describe('the exits that are not a choice', () => {
    it('treats a scrim tap as Cancel', async () => {
      const { destructive, onCancel } = await renderDialog();

      fireEvent.press(screen.getByTestId('dialog-scrim'));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(destructive.onPress).not.toHaveBeenCalled();
    });

    it('treats Android back as Cancel', async () => {
      // `onRequestClose` is the system contract on Android. Wiring it anywhere other
      // than Cancel would make the hardware back button destructive.
      const { destructive, onCancel } = await renderDialog();

      fireEvent(modalHost(), 'requestClose');

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(destructive.onPress).not.toHaveBeenCalled();
    });

    it('does not cancel when the tap lands inside the dialog', async () => {
      // The dialog sits inside the scrim, so without its own press handler every tap on
      // the title would dismiss it.
      const { destructive, onCancel } = await renderDialog();

      fireEvent.press(screen.getByTestId('dialog'));

      expect(onCancel).not.toHaveBeenCalled();
      expect(destructive.onPress).not.toHaveBeenCalled();
    });

    it('takes itself out of the accessibility tree without taking the dialog with it', async () => {
      // A screen reader user does not tap a scrim to dismiss; they reach Cancel, which
      // is a real button with a real name. So the scrim hides *itself* — it is a huge
      // unnamed target that would destroy the user's context if hit by accident.
      //
      // What it must not do is hide its descendants, and the distinction is the whole
      // case: `accessibilityElementsHidden` with `no-hide-descendants` here would take
      // the title, Delete and Cancel out of the tree along with it, leaving a modal that
      // a screen reader user can neither read nor answer while it blocks everything
      // behind it.
      await renderDialog();
      const scrim = screen.getByTestId('dialog-scrim');

      expect(scrim.props.accessible).toBe(false);
      expect(scrim.props.importantForAccessibility).toBe('no');
      expect(scrim.props.accessibilityElementsHidden).toBeFalsy();

      // The things behind it are still reachable by a query that respects the tree.
      expect(screen.getByRole('header', { name: 'Delete this expense?' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
  });
});
