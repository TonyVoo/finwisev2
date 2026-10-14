import { Text } from 'react-native';
import { screen, userEvent } from '@testing-library/react-native';
import { AppBar, Fab, IconButton, PendingGlyph, SkeletonBlock } from '@/components/Chrome';
import { HIT_SLOP_44, color, elevation, size, space } from '@/theme/tokens';
import { SAFE_AREA_METRICS, flattenStyle, renderWithSafeArea } from '../support/safeArea';

/**
 * The shared screen furniture: `docs/design/00-foundations.md` §3 and §8, and the app bar
 * and FAB rows of `04-expense-list.md` §Elements.
 *
 * None of these own behaviour, so the cases worth having are the ones about geometry that
 * a reviewer could only catch on a device with the wrong notch — above all the two places
 * a safe-area inset is *added* to a dimension rather than substituted for it. Getting that
 * backwards does not look broken in a simulator with no inset at all, which is exactly
 * why it needs a test.
 */

function styleOf(testID: string): Record<string, unknown> {
  return flattenStyle(screen.getByTestId(testID).props.style);
}

/**
 * Query an element that is hidden from the accessibility tree.
 *
 * RNTL's default `includeHiddenElements: false` cannot see the skeleton or the pending
 * glyph at all — which is the behaviour those two want, so it is asserted directly below
 * rather than worked around silently.
 */
function getDecorative(testID: string) {
  return screen.getByTestId(testID, { includeHiddenElements: true });
}

describe('AppBar', () => {
  it('renders the title as a heading', async () => {
    await renderWithSafeArea(<AppBar title="Expenses" />);

    expect(screen.getByRole('header', { name: 'Expenses' })).toBeTruthy();
  });

  it('renders the leading and trailing slots', async () => {
    await renderWithSafeArea(
      <AppBar title="Expenses" leading={<Text>Back</Text>} trailing={<Text>Settings</Text>} />,
    );

    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('adds the top inset to its own height instead of standing in for it', async () => {
    // `00-foundations.md` §3. The bar is 56 tall *below* the status bar, so the inset is
    // padding on the outer layer and the 56 stays on the inner one. A single layer with
    // `height: 56` that happened to include a 47pt inset would leave 9pt of usable bar.
    await renderWithSafeArea(<AppBar title="Expenses" testID="bar" />);

    expect(styleOf('bar').paddingTop).toBe(SAFE_AREA_METRICS.insets.top);
    expect(styleOf('bar-content').minHeight).toBe(size.appBarHeight);
    // A floor, as everywhere else: the title grows with the OS font scale.
    expect(styleOf('bar-content').height).toBeUndefined();
  });

  it('is flat until the list below it has scrolled', async () => {
    // `04-expense-list.md` element 1: the shadow appears on scroll, so a bar that is
    // always elevated says the content is scrolled when it is not.
    await renderWithSafeArea(<AppBar title="Expenses" testID="bar" />);

    expect(styleOf('bar').shadowOpacity).toBeUndefined();
    expect(styleOf('bar').elevation).toBeUndefined();
  });

  it('takes elevation.1 once it is elevated', async () => {
    await renderWithSafeArea(<AppBar title="Expenses" elevated testID="bar" />);

    expect(styleOf('bar').shadowOpacity).toBe(elevation[1].shadowOpacity);
    expect(styleOf('bar').elevation).toBe(elevation[1].elevation);
  });

  it('leaves the title leading-aligned by default', async () => {
    await renderWithSafeArea(<AppBar title="Expenses" />);

    expect(flattenStyle(screen.getByRole('header').props.style).textAlign).toBeUndefined();
  });

  it('centres the title when asked, as the expense form does', async () => {
    await renderWithSafeArea(<AppBar title="New expense" centred />);

    expect(flattenStyle(screen.getByRole('header').props.style).textAlign).toBe('center');
  });
});

describe('IconButton', () => {
  it('names itself for a screen reader, since the glyph cannot', async () => {
    await renderWithSafeArea(<IconButton icon="settings" label="Settings" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await renderWithSafeArea(
      <IconButton icon="x" label="Close" onPress={onPress} testID="close" />,
    );

    await userEvent.press(screen.getByTestId('close'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('grows a 24pt glyph to a 44pt target with hit slop', async () => {
    // §8 rule 1. Padding the layout to 44 instead would push the glyph off the bar's
    // alignment, so the target is grown outside the box rather than inside it.
    await renderWithSafeArea(<IconButton icon="x" label="Close" onPress={jest.fn()} testID="x" />);
    const button = screen.getByTestId('x');

    expect(button.props.hitSlop).toEqual(HIT_SLOP_44);
    const laidOut = styleOf('x').minHeight as number;
    expect(laidOut + HIT_SLOP_44.top + HIT_SLOP_44.bottom).toBeGreaterThanOrEqual(
      size.tapTargetMin,
    );
  });
});

describe('Fab', () => {
  it('names the action it performs', async () => {
    await renderWithSafeArea(<Fab label="Add expense" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Add expense' })).toBeTruthy();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await renderWithSafeArea(<Fab label="Add expense" onPress={onPress} testID="fab" />);

    await userEvent.press(screen.getByTestId('fab'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('clears the bottom inset and whatever sits below it', async () => {
    // The offset is the tab bar's height on Home. Ignoring it would park the FAB on top
    // of the tab bar; ignoring the inset would park it under the home indicator.
    const tabBarHeight = 56;
    await renderWithSafeArea(
      <Fab label="Add expense" onPress={jest.fn()} bottomOffset={tabBarHeight} testID="fab" />,
    );

    expect(styleOf('fab').bottom).toBe(SAFE_AREA_METRICS.insets.bottom + tabBarHeight + space[4]);
  });

  it('still clears the inset on a screen with nothing below it', async () => {
    await renderWithSafeArea(<Fab label="New category" onPress={jest.fn()} testID="fab" />);

    expect(styleOf('fab').bottom).toBe(SAFE_AREA_METRICS.insets.bottom + space[4]);
  });

  it('is a 56pt circle at the trailing edge', async () => {
    await renderWithSafeArea(<Fab label="Add expense" onPress={jest.fn()} testID="fab" />);
    const style = styleOf('fab');

    expect(style.width).toBe(size.fab);
    expect(style.height).toBe(size.fab);
    // `radius.pill` rather than `size.fab / 2`, so it stays a circle if the size changes.
    expect(style.borderRadius as number).toBeGreaterThanOrEqual(size.fab / 2);
    expect(style.right).toBe(space[4]);
  });
});

describe('SkeletonBlock', () => {
  it('takes the dimensions it is given', async () => {
    await renderWithSafeArea(<SkeletonBlock width="60%" height={20} testID="skeleton" />);
    const style = flattenStyle(getDecorative('skeleton').props.style);

    expect(style.width).toBe('60%');
    expect(style.height).toBe(20);
    expect(style.backgroundColor).toBe(color.bg.sunken);
  });

  it('is invisible to a screen reader', async () => {
    // It stands in for text that has not loaded. Announcing it would read the shape of
    // the absence out loud, which tells the user nothing.
    await renderWithSafeArea(<SkeletonBlock width={120} height={20} testID="skeleton" />);

    expect(screen.queryByTestId('skeleton')).toBeNull();
    const block = getDecorative('skeleton');
    expect(block.props.accessibilityElementsHidden).toBe(true);
    expect(block.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});

describe('PendingGlyph', () => {
  it('is a 14pt warning-coloured glyph', async () => {
    // `02-offline-and-sync.md` §2: `warning`, never `danger`. Not yet synced is a state
    // of the world, not an error the user made.
    await renderWithSafeArea(<PendingGlyph />);
    const style = flattenStyle(getDecorative('pending-glyph').props.style);

    expect(style.fontSize).toBe(size.syncGlyph);
    expect(style.color).toBe(color.warning.default);
    expect(style.color).not.toBe(color.danger.default);
  });

  it('is decorative, because the row it sits in says it in words', async () => {
    // The expense row appends `, not synced yet` to its own composed label (§2). If the
    // glyph announced itself too, the row would say it twice.
    await renderWithSafeArea(<PendingGlyph />);

    // Not reachable at all by a query that respects the accessibility tree.
    expect(screen.queryByTestId('pending-glyph')).toBeNull();
    expect(getDecorative('pending-glyph').props.accessibilityElementsHidden).toBe(true);
  });
});
