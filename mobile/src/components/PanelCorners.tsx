import { StyleSheet, View } from 'react-native';
import { createStyles } from '../theme/ThemeProvider';

export const PANEL_CORNERS_TEST_ID = 'panel-corners';

/**
 * Four small gold brackets at the corners of a panel, the way a scroll or a talisman is edged. Drawn over the panel's
 * own edge, decoration only and hidden from a screen reader; used only in the cultivation appearance.
 */
export function PanelCorners() {
  const styles = useStyles();
  return (
    <View
      testID={PANEL_CORNERS_TEST_ID}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.corner, styles.tl]} />
      <View style={[styles.corner, styles.tr]} />
      <View style={[styles.corner, styles.bl]} />
      <View style={[styles.corner, styles.br]} />
    </View>
  );
}

const ARM = 12;
const useStyles = createStyles((color) =>
  StyleSheet.create({
    corner: { position: 'absolute', width: ARM, height: ARM, borderColor: color.primary.default },
    tl: { top: 3, left: 3, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
    tr: { top: 3, right: 3, borderTopWidth: 1.5, borderRightWidth: 1.5 },
    bl: { bottom: 3, left: 3, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
    br: { bottom: 3, right: 3, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  }),
);
