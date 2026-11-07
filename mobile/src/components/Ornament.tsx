import { StyleSheet, Text, View } from 'react-native';
import { space } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const ORNAMENT_TEST_ID = 'ornament';

/**
 * A thin gold rule with a diamond at its centre, drawn under a screen's title in the cultivation skin. Decoration
 * only: hidden from a screen reader, and plain Views and one glyph, so it costs nothing and renders in tests.
 */
export function Ornament() {
  const styles = useStyles();
  return (
    <View
      testID={ORNAMENT_TEST_ID}
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.line} />
      <Text style={styles.diamond}>◆</Text>
      <View style={styles.line} />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      paddingHorizontal: space[4],
      paddingBottom: space[2],
    },
    line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.border.strong },
    diamond: { color: color.primary.default, fontSize: 9, lineHeight: 12 },
  }),
);
