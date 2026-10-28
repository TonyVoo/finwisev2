import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyHaptic } from '../lib/haptics';
import { elevation, radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

/**
 * The few things the bar reads from the navigator. Declared here, structurally, because the
 * navigator's own prop types are not a public import of this app; the real props satisfy it.
 */
export interface FloatingTabBarProps {
  readonly state: {
    readonly index: number;
    readonly routes: ReadonlyArray<{
      readonly key: string;
      readonly name: string;
      readonly params?: object;
    }>;
  };
  readonly descriptors: Readonly<
    Record<
      string,
      {
        readonly options: {
          readonly title?: string;
          readonly tabBarIcon?: (props: {
            focused: boolean;
            color: string;
            size: number;
          }) => ReactNode;
        };
      }
    >
  >;
  readonly navigation: {
    emit(event: { type: 'tabPress'; target: string; canPreventDefault: true }): {
      readonly defaultPrevented: boolean;
    };
    navigate(name: string, params?: object): void;
  };
}

/** The floating bar's own height, and the gap between it and the screen's bottom edge. */
const BAR_HEIGHT = 64;
const BAR_GAP = 6;

/**
 * How much of the screen the floating bar covers, below the home indicator: what a screen
 * adds to its bottom padding (and the add button to its offset) so nothing ends up under it.
 */
export const TAB_BAR_RESERVE = BAR_HEIGHT + BAR_GAP + space[3];

/** The bar's footprint including the home-indicator inset, for a screen's bottom padding. */
export function useTabBarClearance(): number {
  return useSafeAreaInsets().bottom + TAB_BAR_RESERVE;
}

/** A light tick when you switch tabs; nothing for pressing the tab you are already on. */
export function tabPressHaptic(alreadyFocused: boolean): void {
  if (!alreadyFocused) keyHaptic();
}

/**
 * The tab bar, as a capsule that floats above the bottom edge instead of sticking to it. The
 * active tab shows its icon and label on a highlight; the others are icons alone, and still
 * carry their names for a screen reader.
 *
 * It floats *over* the screen, so it takes no space in the layout: screens add
 * `useTabBarClearance()` to their bottom padding.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const color = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="tab-bar"
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + BAR_GAP }]}
    >
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key] ?? { options: {} };
          const focused = state.index === index;
          const title = options.title ?? route.name;
          const tint = focused ? color.primary.default : color.text.tertiary;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (focused || event.defaultPrevented) return;
            tabPressHaptic(false);
            navigation.navigate(route.name, route.params);
          };

          return (
            <Pressable
              key={route.key}
              testID={`tab-${route.name}`}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityLabel={title}
              accessibilityState={{ selected: focused }}
              style={[styles.item, focused ? { backgroundColor: color.primary.subtle } : null]}
            >
              {options.tabBarIcon?.({ focused, color: tint, size: 22 })}
              {focused ? <Text style={[styles.label, { color: tint }]}>{title}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    bar: {
      ...elevation[2],
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      height: BAR_HEIGHT,
      padding: space[2],
      borderRadius: radius.pill,
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      height: BAR_HEIGHT - space[2] * 2,
      minWidth: BAR_HEIGHT - space[2] * 2 + space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.pill,
    },
    label: {
      ...type.callout,
      fontWeight: '600',
    },
  }),
);
