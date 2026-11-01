import * as Haptics from 'expo-haptics';
import { Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import {
  FloatingTabBar,
  type FloatingTabBarProps,
  TAB_BAR_RESERVE,
  tabPressHaptic,
} from '@/navigation/tabBar';
import { TabBarStyleProvider, type TabBarStyle } from '@/navigation/tabBarStyle';
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

describe('the bar styles', () => {
  async function renderStyled(style: TabBarStyle, index = 0) {
    await renderWithSafeArea(
      <TabBarStyleProvider database={undefined} initialStyle={style}>
        <FloatingTabBar {...props(index).bar} />
      </TabBarStyleProvider>,
    );
  }

  it('compact hugs its tabs and names only the active one', async () => {
    await renderStyled('compact');

    expect(flattenStyle(screen.getByTestId('tab-bar-surface', hidden).props.style).alignSelf).toBe(
      'center',
    );
    expect(screen.queryByText('Summary')).toBeNull();
  });

  it('wide spans the screen with equal slots, still naming only the active tab', async () => {
    await renderStyled('wide');

    expect(flattenStyle(screen.getByTestId('tab-bar-surface', hidden).props.style).alignSelf).toBe(
      'stretch',
    );
    expect(flattenStyle(screen.getByTestId('tab-summary').props.style).flex).toBe(1);
    expect(screen.queryByText('Summary')).toBeNull();
    expect(screen.getByText('Expenses')).toBeTruthy();
  });

  it('labelled names every tab, active or not', async () => {
    await renderStyled('labelled', 1);

    expect(screen.getByText('Expenses')).toBeTruthy();
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('labelled is taller than compact', async () => {
    await renderStyled('labelled');
    const labelled = flattenStyle(screen.getByTestId('tab-bar-surface', hidden).props.style);

    expect(labelled.height as number).toBeGreaterThan(64);
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

describe('FloatingTabBar with the camera shortcut', () => {
  beforeEach(() => jest.clearAllMocks());

  function withScan(onScan?: () => void) {
    const emit = jest.fn(() => ({ defaultPrevented: false }));
    const navigate = jest.fn();
    const routes = [
      { key: 'index-1', name: 'index' },
      { key: 'summary-1', name: 'summary' },
      { key: 'scan-1', name: 'scan' },
      { key: 'goals-1', name: 'goals' },
      { key: 'settings-1', name: 'settings' },
    ];
    const titles: Record<string, string> = {
      index: 'Expenses',
      summary: 'Summary',
      scan: 'Scan receipt',
      goals: 'Goals',
      settings: 'Settings',
    };
    const descriptors = Object.fromEntries(
      routes.map((route) => [
        route.key,
        {
          options: {
            title: titles[route.name],
            tabBarIcon: () => <Text>{`icon-${route.name}`}</Text>,
          },
        },
      ]),
    );
    const bar = {
      state: { index: 0, routes },
      descriptors,
      navigation: { emit, navigate },
    } as unknown as FloatingTabBarProps;
    return { emit, navigate, element: <FloatingTabBar {...bar} onScan={onScan} /> };
  }

  it('puts the camera in the middle, two tabs each side, named for a screen reader', async () => {
    const { element } = withScan(jest.fn());
    await renderWithSafeArea(element);

    expect(screen.getByRole('button', { name: 'Scan receipt' })).toBeTruthy();
    // Four real tabs; the camera is an action, not a place, and sits between the pairs.
    const order = screen
      .getAllByTestId(/^tab-(index|summary|scan|goals|settings)$/)
      .map((node) => String(node.props.testID).replace('tab-', ''));
    expect(order).toEqual(['index', 'summary', 'scan', 'goals', 'settings']);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('labels every tab under its icon, so no label stretches a slot and pushes the camera off the middle', async () => {
    const { element } = withScan(jest.fn());
    await renderWithSafeArea(element);

    for (const label of ['Expenses', 'Summary', 'Goals', 'Settings']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    const slot = flattenStyle(screen.getByTestId('tab-summary').props.style);
    expect(slot.flexDirection).toBe('column');
    expect(slot.flex).toBe(1);
  });

  it('runs the shortcut when pressed, without changing tab', async () => {
    const onScan = jest.fn();
    const { navigate, emit, element } = withScan(onScan);
    await renderWithSafeArea(element);

    fireEvent.press(screen.getByTestId('tab-scan'));

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('is left out of the bar when nothing handles it', async () => {
    const { element } = withScan(undefined);
    await renderWithSafeArea(element);

    expect(screen.queryByTestId('tab-scan')).toBeNull();
  });
});
