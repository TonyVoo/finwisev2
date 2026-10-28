import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyHaptic } from '../lib/haptics';
import { TAB_BAR_GAP, tabBarHeight, tabBarReserve, useTabBarStyle } from './tabBarStyle';
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

/** What the compact bar covers; the default, and what a screen without a style context assumes. */
export const TAB_BAR_RESERVE = tabBarReserve('compact');

/** How much of the screen the bar covers, below the home indicator, in the current style. */
export function useTabBarReserve(): number {
  return tabBarReserve(useTabBarStyle().style);
}

/** The bar's footprint including the home-indicator inset, for a screen's bottom padding. */
export function useTabBarClearance(): number {
  return useSafeAreaInsets().bottom + useTabBarReserve();
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
  const { style } = useTabBarStyle();
  const spans = style !== 'compact';
  const labelled = style === 'labelled';

  return (
    <View
      testID="tab-bar"
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_GAP }, spans ? styles.wrapWide : null]}
    >
      <View
        testID="tab-bar-surface"
        style={[
          styles.bar,
          { height: tabBarHeight(style) },
          spans ? styles.barWide : styles.barCompact,
        ]}
      >
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
              style={[
                styles.item,
                { height: tabBarHeight(style) - space[2] * 2 },
                spans ? styles.itemSlot : null,
                labelled ? styles.itemStacked : null,
                focused ? { backgroundColor: color.primary.subtle } : null,
              ]}
            >
              {options.tabBarIcon?.({ focused, color: tint, size: 22 })}
              {focused || labelled ? (
                <Text
                  style={[labelled ? styles.labelSmall : styles.label, { color: tint }]}
                  numberOfLines={1}
                >
                  {title}
                </Text>
              ) : null}
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
    // The wide styles leave a margin each side and let the bar fill what is left.
    wrapWide: {
      paddingHorizontal: space[4],
      alignItems: 'stretch',
    },
    bar: {
      ...elevation[2],
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      padding: space[2],
      borderRadius: radius.pill,
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    barCompact: { alignSelf: 'center' },
    barWide: { alignSelf: 'stretch' },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      minWidth: 48 + space[3],
      paddingHorizontal: space[4],
      borderRadius: radius.pill,
    },
    // Equal slots across the wide bar.
    itemSlot: { flex: 1, paddingHorizontal: space[2] },
    // A label under the icon, which is what lets every tab carry one.
    itemStacked: { flexDirection: 'column', gap: 2 },
    label: {
      ...type.callout,
      fontWeight: '600',
    },
    labelSmall: {
      ...type.caption,
      fontWeight: '600',
    },
  }),
);
