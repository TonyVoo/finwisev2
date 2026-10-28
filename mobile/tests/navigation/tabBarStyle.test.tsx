import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import {
  TAB_BAR_STYLES,
  TabBarStyleProvider,
  parseTabBarStyle,
  tabBarReserve,
  useTabBarStyle,
} from '@/navigation/tabBarStyle';
import { migrate } from '@/db/migrations';
import { META_KEYS, readMeta } from '@/db/meta';
import { act } from '@testing-library/react-native';
import { createTestDatabase } from '../support/sqlite';

describe('parseTabBarStyle', () => {
  it('reads each style, and falls back to compact for nothing or junk', () => {
    for (const style of TAB_BAR_STYLES) expect(parseTabBarStyle(style)).toBe(style);
    expect(parseTabBarStyle(null)).toBe('compact');
    expect(parseTabBarStyle(undefined)).toBe('compact');
    expect(parseTabBarStyle('huge')).toBe('compact');
  });
});

describe('tabBarReserve', () => {
  it('is taller for the labelled bar, which stacks a label under each icon', () => {
    expect(tabBarReserve('labelled')).toBeGreaterThan(tabBarReserve('compact'));
    expect(tabBarReserve('wide')).toBe(tabBarReserve('compact'));
  });
});

describe('TabBarStyleProvider', () => {
  function Probe() {
    const { style, setStyle } = useTabBarStyle();
    return <Text onPress={() => setStyle('wide')}>{style}</Text>;
  }

  it('starts from the stored style, and defaults to compact with no provider', async () => {
    await render(<Probe />);
    expect(screen.getByText('compact')).toBeTruthy();
  });

  it('switches at once and remembers the choice on the device', async () => {
    const database = createTestDatabase();
    await migrate(database);
    await render(
      <TabBarStyleProvider database={database} initialStyle="labelled">
        <Probe />
      </TabBarStyleProvider>,
    );
    expect(screen.getByText('labelled')).toBeTruthy();

    await act(async () => screen.getByText('labelled').props.onPress());

    expect(screen.getByText('wide')).toBeTruthy();
    expect(await readMeta(database, META_KEYS.tabBarStyle)).toBe('wide');
    database.close();
  });
});
