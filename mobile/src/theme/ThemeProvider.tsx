import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { type ColorScheme, type ColorTokens, darkColor, lightColor, resolveScheme } from './tokens';

/**
 * The theme, as React state.
 *
 * Until now the palette was chosen once at import and baked into module-level
 * `StyleSheet.create` calls, so it could only follow the system setting at launch. Now a
 * component asks for its colours (`useColors`) and its styles (`createStyles` +
 * `useStyles`) while rendering, and a change of scheme re-renders the tree: the phone
 * flipping to dark at sunset, or the person choosing a theme in Settings, shows
 * immediately.
 *
 * Three preferences, one resolved scheme. `system` follows the phone; `light` and `dark`
 * pin the app regardless of it. The choice is stored by the caller (`onPreferenceChange`),
 * because where it lives - the `meta` table - is a database concern this file has no
 * business knowing.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export interface ThemeValue {
  readonly scheme: ColorScheme;
  readonly isDark: boolean;
  readonly color: ColorTokens;
  readonly preference: ThemePreference;
  readonly setPreference: (next: ThemePreference) => void;
}

/**
 * Light, with a setter that does nothing.
 *
 * What a component sees outside any provider - which is every component test that mounts
 * a lone widget - so none of them has to wrap itself in a theme just to render.
 */
const DEFAULT_THEME: ThemeValue = {
  scheme: 'light',
  isDark: false,
  color: lightColor,
  preference: 'system',
  setPreference: () => undefined,
};

const ThemeContext = createContext<ThemeValue>(DEFAULT_THEME);

/**
 * Tell the OS what the app is showing, so the chrome the app does not draw itself - the
 * keyboard, native alerts, the system pickers - matches a pinned choice. Best effort: a
 * platform or test host without it just keeps the system's setting for that chrome.
 */
export function applyThemePreference(preference: ThemePreference): void {
  try {
    Appearance.setColorScheme?.(preference === 'system' ? 'unspecified' : preference);
  } catch {
    // Nothing to do: the app's own colours do not depend on this call.
  }
}

export interface ThemeProviderProps {
  readonly initialPreference?: ThemePreference;
  /** Persist the choice. Fire-and-forget: a failed write must not undo what was chosen. */
  readonly onPreferenceChange?: (next: ThemePreference) => void;
  readonly children: ReactNode;
}

export function ThemeProvider({
  initialPreference = 'system',
  onPreferenceChange,
  children,
}: ThemeProviderProps) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      applyThemePreference(next);
      onPreferenceChange?.(next);
    },
    [onPreferenceChange],
  );

  const scheme: ColorScheme = preference === 'system' ? resolveScheme(system) : preference;

  const value = useMemo<ThemeValue>(
    () => ({
      scheme,
      isDark: scheme === 'dark',
      color: scheme === 'dark' ? darkColor : lightColor,
      preference,
      setPreference,
    }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** The palette for the scheme in force. The replacement for importing `color`. */
export function useColors(): ColorTokens {
  return useContext(ThemeContext).color;
}

/**
 * A stylesheet that depends on the palette.
 *
 * `factory` receives the palette (and `isDark`, for the rare value that is not a token)
 * and returns what `StyleSheet.create` would. The result is built once per scheme and
 * cached, so toggling back and forth allocates nothing after the first of each. Name the
 * factory's parameter `color`: inside it, every `color.x.y` reads exactly as it did when
 * `color` was a module import.
 */
export function createStyles<T>(
  factory: (color: ColorTokens, theme: { readonly isDark: boolean }) => T,
): () => T {
  const cache = new Map<ColorScheme, T>();

  return function useStyles(): T {
    const { scheme, color, isDark } = useTheme();
    let styles = cache.get(scheme);
    if (styles === undefined) {
      styles = factory(color, { isDark });
      cache.set(scheme, styles);
    }
    return styles;
  };
}
