import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { createStyles, useColors } from '../theme/ThemeProvider';

/**
 * The icon above an empty state: a soft circle with a glyph. Decorative - the headline under
 * it says what is missing, so a screen reader skips this (`04-expense-list.md` rule 7).
 */
export function EmptyIcon({ name }: { readonly name: ComponentProps<typeof Feather>['name'] }) {
  const color = useColors();
  const styles = useStyles();
  return (
    <View
      testID="empty-icon"
      style={styles.circle}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Feather testID={`empty-icon-${name}`} name={name} size={32} color={color.primary.default} />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    circle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: color.primary.subtle,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
  }),
);
