import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/** iPhone-ish metrics. Any fixed value will do; the screens only read the insets. */
export const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Render a component that reads the safe-area insets and nothing else.
 *
 * The native metrics `useSafeAreaInsets` would otherwise read do not exist under jest, so
 * the provider is handed the fixed {@link SAFE_AREA_METRICS} above. A case that asserts on
 * a position therefore states the arithmetic it expects — `insets.bottom + offset +
 * space[4]` — rather than a bare number, so it still fails if the component stops
 * consulting the inset at all.
 */
export async function renderWithSafeArea(element: ReactElement): Promise<void> {
  function Wrapper({ children }: { children: ReactNode }) {
    return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
  }

  await render(element, { wrapper: Wrapper });
}

/**
 * Flatten whatever `style` a component handed its host element.
 *
 * React Native accepts a style as an object, an array, or an array of arrays once a
 * `Pressable` has merged its own in — so a case that wants to ask about one property
 * should not have to know which of those it got.
 */
export function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(3) : [style])) as Record<
    string,
    unknown
  >;
}
