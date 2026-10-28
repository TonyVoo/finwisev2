import * as Haptics from 'expo-haptics';
import { render, screen } from '@testing-library/react-native';
import { TabIcon, tabPressHaptic } from '@/navigation/tabBar';
import { flattenStyle } from '../support/safeArea';

const hidden = { includeHiddenElements: true };

describe('TabIcon', () => {
  it('draws the named icon', async () => {
    await render(<TabIcon name="list" focused={false} tint="#000" />);

    expect(screen.getByTestId('tab-icon-list', hidden)).toBeTruthy();
  });

  it('sits the active tab on a soft pill, and leaves the others bare', async () => {
    const view = await render(<TabIcon name="list" focused tint="#000" />);
    const active = flattenStyle(screen.getByTestId('tab-pill-list', hidden).props.style);

    await view.rerender(<TabIcon name="list" focused={false} tint="#000" />);
    const inactive = flattenStyle(screen.getByTestId('tab-pill-list', hidden).props.style);

    expect(active.backgroundColor).toBeDefined();
    expect(inactive.backgroundColor).toBe('transparent');
  });

  it('is decorative: the tab already has its label', async () => {
    await render(<TabIcon name="list" focused tint="#000" />);

    expect(screen.getByTestId('tab-pill-list', hidden).props.accessibilityElementsHidden).toBe(
      true,
    );
  });
});

describe('tabPressHaptic', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ticks when switching to another tab', () => {
    tabPressHaptic(false);

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when pressing the tab you are already on', () => {
    tabPressHaptic(true);

    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });
});
