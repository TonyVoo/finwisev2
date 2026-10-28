import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { META_KEYS, writeMeta } from '../db/meta';
import type { SqliteDatabase } from '../db/sqlite';
import { space } from '../theme/tokens';

/**
 * How the floating tab bar looks. A device preference, like the theme and the language: chosen
 * in Settings, applied at once, remembered across launches, and kept when signing out.
 *
 *  - `compact`: a capsule that hugs its tabs; only the active tab shows its label.
 *  - `wide`: the capsule spans the screen with equal slots; still only the active label.
 *  - `labelled`: spans the screen, and every tab shows its label under its icon.
 */
export const TAB_BAR_STYLES = ['compact', 'wide', 'labelled'] as const;
export type TabBarStyle = (typeof TAB_BAR_STYLES)[number];

export function parseTabBarStyle(raw: string | null | undefined): TabBarStyle {
  return TAB_BAR_STYLES.find((style) => style === raw) ?? 'compact';
}

/** The bar's own height, which the labelled style makes taller to fit a label under each icon. */
export function tabBarHeight(style: TabBarStyle): number {
  return style === 'labelled' ? 72 : 64;
}

/** The gap between the bar and the screen's bottom edge. */
export const TAB_BAR_GAP = 6;

/**
 * How much of the screen the bar covers, below the home indicator: what a screen adds to its
 * bottom padding (and the add button to its offset) so nothing ends up under it.
 */
export function tabBarReserve(style: TabBarStyle): number {
  return tabBarHeight(style) + TAB_BAR_GAP + space[3];
}

interface TabBarStyleContextValue {
  readonly style: TabBarStyle;
  readonly setStyle: (next: TabBarStyle) => void;
}

const TabBarStyleContext = createContext<TabBarStyleContextValue>({
  style: 'compact',
  setStyle: () => undefined,
});

export function TabBarStyleProvider({
  database,
  initialStyle = 'compact',
  children,
}: {
  /** Where the choice is remembered. Absent in tests that only need the value. */
  readonly database?: SqliteDatabase | undefined;
  readonly initialStyle?: TabBarStyle;
  readonly children: ReactNode;
}) {
  const [style, setStyleState] = useState<TabBarStyle>(initialStyle);

  const setStyle = useCallback(
    (next: TabBarStyle) => {
      setStyleState(next);
      // Fire-and-forget: a failed write must not undo a choice already on screen.
      if (database !== undefined) {
        void writeMeta(database, META_KEYS.tabBarStyle, next).catch(() => undefined);
      }
    },
    [database],
  );

  const value = useMemo(() => ({ style, setStyle }), [style, setStyle]);
  return <TabBarStyleContext.Provider value={value}>{children}</TabBarStyleContext.Provider>;
}

export function useTabBarStyle(): TabBarStyleContextValue {
  return useContext(TabBarStyleContext);
}
