import { Text } from 'react-native';
import { Row, RowSubtitle, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { createStyles } from '../theme/ThemeProvider';
import { TAB_BAR_STYLES, type TabBarStyle, useTabBarStyle } from './tabBarStyle';

/**
 * The tab bar style choice: three rows, the current one ticked. Picking one applies at once and
 * closes the sheet, as the theme sheet does.
 */

export const TAB_BAR_STYLE_SHEET_TEST_ID = 'tab-bar-style-sheet';
export const TAB_BAR_STYLE_OPTION_TEST_ID_PREFIX = 'tab-bar-style';

export function tabBarStyleLabel(style: TabBarStyle): string {
  return COPY.tabBarStyle[style];
}

export function TabBarStyleSheet({
  visible,
  onClose,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const { style, setStyle } = useTabBarStyle();
  const styles = useStyles();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={COPY.tabBarStyle.title}
      testID={TAB_BAR_STYLE_SHEET_TEST_ID}
    >
      {TAB_BAR_STYLES.map((option, index) => {
        const selected = option === style;
        return (
          <Row
            key={option}
            testID={`${TAB_BAR_STYLE_OPTION_TEST_ID_PREFIX}-${option}`}
            onPress={() => {
              setStyle(option);
              onClose();
            }}
            lastInGroup={index === TAB_BAR_STYLES.length - 1}
            accessibilityLabel={tabBarStyleLabel(option)}
            accessibilityState={{ selected }}
            trailing={
              selected ? (
                <Text style={styles.check} accessibilityElementsHidden>
                  ✓
                </Text>
              ) : null
            }
          >
            <RowTitle>{tabBarStyleLabel(option)}</RowTitle>
            <RowSubtitle lines={2}>{COPY.tabBarStyle.hint[option]}</RowSubtitle>
          </Row>
        );
      })}
    </Sheet>
  );
}

const useStyles = createStyles((color) => ({
  check: { fontSize: 16, fontWeight: '600' as const, color: color.primary.default },
}));
