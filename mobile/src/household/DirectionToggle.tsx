import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * Who paid, at the top of Settle up: "I paid" or "They paid me". Two buttons rather than a switch,
 * like the expense form's kind toggle: both options are named on screen and the selected one is
 * announced as such.
 */
export function DirectionToggle({
  iPaid,
  onChange,
}: {
  readonly iPaid: boolean;
  readonly onChange: (iPaid: boolean) => void;
}) {
  const styles = useStyles();
  const options = [
    { id: 'i-paid', iPaid: true, label: COPY.household.settle.iPaid },
    { id: 'they-paid', iPaid: false, label: COPY.household.settle.theyPaid },
  ] as const;
  return (
    <View style={styles.track} accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.iPaid === iPaid;
        return (
          <Pressable
            key={option.id}
            testID={`settle-direction-${option.id}`}
            onPress={() => onChange(option.iPaid)}
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
