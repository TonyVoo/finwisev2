import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export type EntryKind = 'expense' | 'income';

export const KIND_TOGGLE_TEST_ID = 'kind-toggle';

/**
 * Expense or income, at the top of the form. Two buttons rather than a switch: both options
 * are named on screen, and the selected one is announced as such.
 */
export function KindToggle({
  value,
  onChange,
}: {
  readonly value: EntryKind;
  readonly onChange: (kind: EntryKind) => void;
}) {
  const styles = useStyles();
  const options: readonly { kind: EntryKind; label: string }[] = [
    { kind: 'expense', label: COPY.form.kind.expense },
    { kind: 'income', label: COPY.form.kind.income },
  ];
  return (
    <View style={styles.track} testID={KIND_TOGGLE_TEST_ID} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.kind === value;
        return (
          <Pressable
            key={option.kind}
            testID={`${KIND_TOGGLE_TEST_ID}-${option.kind}`}
            onPress={() => onChange(option.kind)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[styles.option, selected ? styles.selected : null]}
          >
            <Text style={[styles.label, selected ? styles.labelSelected : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      marginHorizontal: space[4],
      marginTop: space[3],
      padding: 2,
      borderRadius: radius.lg,
      backgroundColor: color.bg.surface,
    },
    option: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.lg,
    },
    selected: { backgroundColor: color.primary.default },
    label: { ...type.bodyStrong, color: color.text.secondary },
    labelSelected: { color: color.text.inverse },
  }),
);
