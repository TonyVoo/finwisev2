import { Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { SwipeToDelete, releaseCommits } from '@/components/SwipeToDelete';

/**
 * Swipe to delete: `docs/design/04-expense-list.md` element 16 and rule 7.
 *
 * The threshold is tested as arithmetic rather than by synthesising a gesture, because
 * the thing most likely to be silently wrong is the **sign** of the comparison, not the
 * animation. `translation` is negative for a leading-to-trailing swipe, so a commit
 * check written as `translation >= rowWidth / 2` would be false for every real swipe and
 * true for the drags the component already clamps away — a row that never deletes, or one
 * that deletes when the user pushes it the wrong way.
 *
 * The rest is about the two things the gesture must not be the only path to: the revealed
 * `Delete` is tappable, and the whole affordance is absent from the accessibility tree
 * because the row above exposes its own `delete` action instead (§Accessibility rule 3).
 */

async function renderRow(
  overrides: Partial<Parameters<typeof SwipeToDelete>[0]> = {},
): Promise<{ readonly onDelete: jest.Mock }> {
  const onDelete = jest.fn();

  await render(
    <SwipeToDelete onDelete={onDelete} actionLabel="Delete" testID="swipe" {...overrides}>
      <Text>Groceries</Text>
    </SwipeToDelete>,
  );

  return { onDelete };
}

describe('releaseCommits', () => {
  const ROW_WIDTH = 390;

  it('commits a release past half the row', () => {
    expect(releaseCommits(-196, ROW_WIDTH)).toBe(true);
  });

  it('commits exactly at half, so the boundary is inclusive', () => {
    expect(releaseCommits(-195, ROW_WIDTH)).toBe(true);
  });

  it('springs back one pixel short of half', () => {
    expect(releaseCommits(-194, ROW_WIDTH)).toBe(false);
  });

  it('springs back from a partial swipe', () => {
    expect(releaseCommits(-40, ROW_WIDTH)).toBe(false);
  });

  it('commits nothing at rest', () => {
    expect(releaseCommits(0, ROW_WIDTH)).toBe(false);
  });

  it('commits nothing for a drag the other way', () => {
    // There is no leading action, so a row never moves right of where it started. A
    // positive translation reaching the threshold would mean the sign was inverted.
    expect(releaseCommits(195, ROW_WIDTH)).toBe(false);
    expect(releaseCommits(400, ROW_WIDTH)).toBe(false);
  });

  it('commits nothing before layout, when the row has no measured width', () => {
    // `rowWidth` is 0 until `onLayout` fires. Half of zero is zero, so without this
    // guard the very first touch would satisfy the threshold and delete the row.
    expect(releaseCommits(0, 0)).toBe(false);
    expect(releaseCommits(-1, 0)).toBe(false);
    expect(releaseCommits(-500, 0)).toBe(false);
  });
});

describe('SwipeToDelete', () => {
  it('renders the row it wraps', async () => {
    await renderRow();

    expect(screen.getByText('Groceries')).toBeTruthy();
  });

  it('renders the action label behind the row', async () => {
    // Queried with hidden elements included, because the action deliberately removes
    // itself from the accessibility tree - see the case below.
    await renderRow();

    expect(screen.getByText('Delete', { includeHiddenElements: true })).toBeTruthy();
  });

  it('deletes when the revealed action is tapped', async () => {
    // Rule 7 gives two ways to commit: releasing past half, or tapping the revealed
    // action. The tap is the one a user who swiped tentatively will reach for.
    const { onDelete } = await renderRow();

    await userEvent.press(screen.getByTestId('swipe-action', { includeHiddenElements: true }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps the revealed action out of the accessibility tree', async () => {
    // The row above exposes a `delete` accessibility action with a real name. Exposing
    // this one too would offer the same action twice, and the second copy's label is
    // bare `Delete` with nothing saying what it deletes.
    await renderRow();

    const action = screen.getByTestId('swipe-action', { includeHiddenElements: true });

    expect(action.props.accessibilityElementsHidden).toBe(true);
    expect(action.props.importantForAccessibility).toBe('no-hide-descendants');
    // And the consequence: nothing named `Delete` is reachable through the tree a
    // screen reader walks.
    expect(screen.queryByText('Delete')).toBeNull();
  });

  describe('when the gesture is disabled', () => {
    it('attaches no pan handlers, so the row cannot be dragged', async () => {
      // The `isDefault` category row has no swipe action at all - it is not
      // revealed-then-blocked, because offering an action that always fails is worse
      // than not offering it (`07-categories.md` §1 rule 4).
      await renderRow({ enabled: false });

      expect(screen.getByTestId('swipe').props.onStartShouldSetResponder).toBeUndefined();
    });

    it('still renders the row', async () => {
      await renderRow({ enabled: false });

      expect(screen.getByText('Groceries')).toBeTruthy();
    });
  });
});
