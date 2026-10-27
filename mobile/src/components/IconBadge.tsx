import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { radius } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

export type IconBadgeName = ComponentProps<typeof Feather>['name'];

/**
 * A small tinted square with a glyph, the leading element of a settings row. Decorative: the
 * row's title says what it is, so a screen reader skips this.
 */
export function IconBadge({
  name,
  tone = 'default',
}: {
  readonly name: IconBadgeName;
  /** `danger` is for a destructive row, so it reads as one before the title does. */
  readonly tone?: 'default' | 'danger';
}) {
  const color = useColors();
  const styles = useStyles();
  const danger = tone === 'danger';
  return (
    <View
      testID="icon-badge"
      style={[
        styles.badge,
        { backgroundColor: danger ? color.danger.subtle : color.primary.subtle },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Feather
        testID={`row-icon-${name}`}
        name={name}
        size={16}
        color={danger ? color.danger.default : color.primary.default}
      />
    </View>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    badge: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
