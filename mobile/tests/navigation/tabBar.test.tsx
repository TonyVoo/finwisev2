import * as Haptics from 'expo-haptics';
import { Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import {
  FloatingTabBar,
  type FloatingTabBarProps,
  TAB_BAR_RESERVE,
  tabPressHaptic,
} from '@/navigation/tabBar';
import { SAFE_AREA_METRICS, flattenStyle, renderWithSafeArea } from '../support/safeArea';

const hidden = { includeHiddenElements: true };

/** Just the parts of the navigator's props the bar reads. */
function props(index: number, overrides: { prevented?: boolean } = {}) {
  const emit = jest.fn(() => ({ defaultPrevented: overrides.prevented === true }));
  const navigate = jest.fn();
  const routes = [
    { key: 'index-1', name: 'index' },
    { key: 'summary-1', name: 'summary' },
    { key: 'settings-1', name: 'settings' },
  ];
  const descriptors = Object.fromEntries(
    routes.map((route) => [
      route.key,
      {
        options: {
          title: { index: 'Expenses', summary: 'Summary', settings: 'Settings' }[route.name],
          tabBarIcon: ({ color }: { color: string }) => (
            <Text>{`icon-${route.name}-${color}`}</Text>
          ),
        },
      },
    ]),
  );
  return {
    emit,
    navigate,
    bar: {
      state: { index, routes },
      descriptors,
      navigation: { emit, navigate },
    } as unknown as FloatingTabBarProps,
  };
}

describe('FloatingTabBar', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the label of the active tab only, as a floating capsule', async () => {
    await renderWithSafeArea(<FloatingTabBar {...props(0).bar} />);

    expect(screen.getByText('Expenses')).toBeTruthy();
    expect(screen.queryByText('Summary')).toBeNull();
  });

  it('carries three tabs, Settings last, each named even when only its icon shows', async () => {
    await renderWithSafeArea(<FloatingTabBar {...props(0).bar} />);

    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('floats: it is lifted off the bottom edge, past the home indicator', async () => {
    await renderWithSafeArea(<FloatingTabBar {...props(0).bar} />);

    const wrap = flattenStyle(screen.getByTestId('tab-bar', hidden).props.style);
    expect(wrap.position).toBe('absolute');
    expect(wrap.bottom as number).toBeGreaterThan(SAFE_AREA_METRICS.insets.bottom);
  });

  it('tells assistive technology which tab is selected, and names every tab', async () => {
    await renderWithSafeArea(<FloatingTabBar {...props(1).bar} />);

    expect(screen.getByTestId('tab-summary').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('tab-index').props.accessibilityState).toEqual({ selected: false });
    // An icon-only tab still has a name.
    expect(screen.getByTestId('tab-index').props.accessibilityLabel).toBe('Expenses');
    expect(screen.getByRole('tab', { name: 'Expenses' })).toBeTruthy();
  });

  it('switches tabs when another is pressed, with a tick', async () => {
    const p = props(0);
    await renderWithSafeArea(<FloatingTabBar {...p.bar} />);

    fireEvent.press(screen.getByTestId('tab-summary'));

    expect(p.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tabPress' }));
    expect(p.navigate).toHaveBeenCalledWith('summary', undefined);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('does nothing for the tab you are already on', async () => {
    const p = props(0);
    await renderWithSafeArea(<FloatingTabBar {...p.bar} />);

    fireEvent.press(screen.getByTestId('tab-index'));

    expect(p.navigate).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('lets a screen veto the switch', async () => {
    const p = props(0, { prevented: true });
    await renderWithSafeArea(<FloatingTabBar {...p.bar} />);

    fireEvent.press(screen.getByTestId('tab-summary'));

    expect(p.navigate).not.toHaveBeenCalled();
  });

  it('reserves a clearance the screens can add to their bottom padding', () => {
    expect(TAB_BAR_RESERVE).toBeGreaterThan(64);
  });
});

describe('tabPressHaptic', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ticks when switching to another tab, and not for the tab you are on', () => {
    tabPressHaptic(false);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);

    tabPressHaptic(true);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});
