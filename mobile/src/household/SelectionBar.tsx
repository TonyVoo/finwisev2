import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COPY } from '../copy/strings';
import { size, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import type { ExpenseSelection } from './useExpenseSelection';

/**
 * The strip shown while picking expenses: how many, and what to do with them. It sits where the
 * screen's own controls are, so a screen shows it instead of its search or month switcher.
 */
export function SelectionBar({ selection }: { readonly selection: ExpenseSelection }) {
  const color = useColors();
  const styles = useStyles();
  const { count } = selection;
  return (
    <View testID="selection-bar" style={styles.bar}>
      <Pressable
        testID="selection-cancel"
        accessibilityRole="button"
        accessibilityLabel={COPY.common.cancel}
        onPress={selection.cancel}
        hitSlop={8}
      >
        <Feather name="x" size={22} color={color.text.primary} />
      </Pressable>
      <Text testID="selection-count" style={styles.count} accessibilityLiveRegion="polite">
        {count === 1
          ? COPY.household.bulk.selectedOne
          : COPY.household.bulk.selectedMany.replace('{count}', String(count))}
      </Text>
      <Pressable
        testID="selection-make-private"
        accessibilityRole="button"
        onPress={() => void selection.apply(true)}
        hitSlop={8}
      >
        <Text style={styles.action}>{COPY.household.bulk.makePrivate}</Text>
      </Pressable>
      <Pressable
        testID="selection-make-shared"
        accessibilityRole="button"
        onPress={() => void selection.apply(false)}
        hitSlop={8}
      >
        <Text style={styles.action}>{COPY.household.bulk.makeShared}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: space[3],
      minHeight: size.tapTargetMin,
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      backgroundColor: color.bg.surface,
      borderBottomWidth: 1,
      borderBottomColor: color.border.input,
    },
    count: { ...type.bodyStrong, color: color.text.primary, flexGrow: 1 },
    action: { ...type.bodyStrong, color: color.primary.default },
  }),
);
