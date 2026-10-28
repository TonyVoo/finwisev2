import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { type ColorValue, StyleSheet, View } from 'react-native';
import { keyHaptic } from '../lib/haptics';
import { radius } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

export type TabIconName = ComponentProps<typeof Feather>['name'];

const PILL_WIDTH = 56;
const PILL_HEIGHT = 30;

/**
 * A tab's icon. The active tab sits on a soft pill, so which tab you are on reads from more
 * than a change of tint. Decorative: the tab has its own label.
 */
export function TabIcon({
  name,
  focused,
  tint,
}: {
  readonly name: TabIconName;
  readonly focused: boolean;
  readonly tint: ColorValue;
}) {
  const color = useColors();
  const styles = useStyles();
  return (
    <View
      testID={`tab-pill-${name}`}
      style={[styles.pill, { backgroundColor: focused ? color.primary.subtle : 'transparent' }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Feather testID={`tab-icon-${name}`} name={name} size={22} color={tint} />
    </View>
  );
}

/** A light tick when you switch tabs; nothing for pressing the tab you are already on. */
export function tabPressHaptic(alreadyFocused: boolean): void {
  if (!alreadyFocused) keyHaptic();
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    pill: {
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
