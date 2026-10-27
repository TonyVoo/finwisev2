import { type ReactNode } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import {
  ThemeProvider,
  type ThemePreference,
  createStyles,
  parseThemePreference,
  useColors,
  useTheme,
} from '@/theme/ThemeProvider';
import { type ColorTokens, darkColor, lightColor } from '@/theme/tokens';

/**
 * The theme as React state: what a component sees, what a change does, and that the
 * per-scheme styles are built once and not on every render.
 */

let mockSystemScheme: 'light' | 'dark' | null = 'light';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));

const useProbeStyles = createStyles((color) => ({ box: { backgroundColor: color.bg.canvas } }));

function Probe() {
  const { scheme, preference, setPreference } = useTheme();
  const color = useColors();
  const styles = useProbeStyles();
  return (
    <>
      <Text testID="scheme">{scheme}</Text>
      <Text testID="preference">{preference}</Text>
      <Text testID="canvas">{color.bg.canvas}</Text>
      <Text testID="box">{String(styles.box.backgroundColor)}</Text>
      <Text testID="pick-dark" onPress={() => setPreference('dark')} />
      <Text testID="pick-light" onPress={() => setPreference('light')} />
      <Text testID="pick-system" onPress={() => setPreference('system')} />
    </>
  );
}

function text(id: string): string {
  const node = screen.getByTestId(id);
  const child = node.props.children as unknown;
  return typeof child === 'string' ? child : '';
}

async function mount(
  children: ReactNode = <Probe />,
  props: Partial<Parameters<typeof ThemeProvider>[0]> = {},
) {
  return await render(<ThemeProvider {...props}>{children}</ThemeProvider>);
}

beforeEach(() => {
  mockSystemScheme = 'light';
});

describe('outside any provider', () => {
  it('is light, with a setter that does nothing, so a lone component renders', async () => {
    await render(<Probe />);

    expect(text('scheme')).toBe('light');
    expect(text('canvas')).toBe(lightColor.bg.canvas);
    expect(() => screen.getByTestId('pick-dark').props.onPress()).not.toThrow();
    expect(text('scheme')).toBe('light');
  });
});

describe('the system preference', () => {
  it('follows the phone', async () => {
    mockSystemScheme = 'dark';
    await mount();

    expect(text('scheme')).toBe('dark');
    expect(text('canvas')).toBe(darkColor.bg.canvas);
  });

  it('treats "no preference" as light', async () => {
    mockSystemScheme = null;
    await mount();

    expect(text('scheme')).toBe('light');
  });

  it('re-renders live when the phone changes theme', async () => {
    const view = await mount();
    expect(text('scheme')).toBe('light');

    mockSystemScheme = 'dark';
    await view.rerender(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(text('scheme')).toBe('dark');
  });
});

describe('a pinned preference', () => {
  it.each([
    ['light', 'dark', lightColor.bg.canvas],
    ['dark', 'light', darkColor.bg.canvas],
  ] as const)('%s ignores a %s phone', async (preference, system, canvas) => {
    mockSystemScheme = system;
    await mount(<Probe />, { initialPreference: preference });

    expect(text('canvas')).toBe(canvas);
  });

  it('switches at once when chosen, and reports the choice for saving', async () => {
    const onPreferenceChange = jest.fn<void, [ThemePreference]>();
    await mount(<Probe />, { onPreferenceChange });

    await act(async () => screen.getByTestId('pick-dark').props.onPress());

    expect(text('scheme')).toBe('dark');
    expect(text('preference')).toBe('dark');
    expect(onPreferenceChange).toHaveBeenCalledWith('dark');

    await act(async () => screen.getByTestId('pick-system').props.onPress());
    expect(text('scheme')).toBe('light');
    expect(onPreferenceChange).toHaveBeenLastCalledWith('system');
  });
});

describe('createStyles', () => {
  it('rebuilds the sheet for the scheme in force', async () => {
    await mount();
    expect(text('box')).toBe(lightColor.bg.canvas);

    await act(async () => screen.getByTestId('pick-dark').props.onPress());
    expect(text('box')).toBe(darkColor.bg.canvas);
  });

  it('builds each scheme once, however often it renders', async () => {
    const factory = jest.fn((color: ColorTokens) => ({
      box: { backgroundColor: color.bg.canvas },
    }));
    const useCounted = createStyles(factory);
    function Counted() {
      useCounted();
      return null;
    }
    const view = await mount(<Counted />);
    await view.rerender(
      <ThemeProvider>
        <Counted />
      </ThemeProvider>,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('parseThemePreference', () => {
  it('accepts the three values and falls back to system for anything else', async () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('sepia')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
  });
});
