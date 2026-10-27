import { Text } from 'react-native';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { THEME_PREFERENCES, type ThemePreference, createStyles, useTheme } from './ThemeProvider';

/**
 * The theme choice: three rows, the current one ticked.
 *
 * Picking one applies at once and closes the sheet. There is no Save button to forget:
 * the effect is visible behind the sheet as it dismisses, which is its own confirmation.
 */

export const THEME_SHEET_TEST_ID = 'theme-sheet';
export const THEME_OPTION_TEST_ID_PREFIX = 'theme-option';

export function themePreferenceLabel(preference: ThemePreference): string {
  return COPY.appearance[preference];
}

export function ThemeSheet({
  visible,
  onClose,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const { preference, setPreference } = useTheme();
  const styles = useStyles();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={COPY.appearance.title}
      testID={THEME_SHEET_TEST_ID}
    >
      {THEME_PREFERENCES.map((option, index) => {
        const selected = option === preference;
        return (
          <Row
            key={option}
            testID={`${THEME_OPTION_TEST_ID_PREFIX}-${option}`}
            onPress={() => {
              setPreference(option);
              onClose();
            }}
            lastInGroup={index === THEME_PREFERENCES.length - 1}
            accessibilityLabel={themePreferenceLabel(option)}
            accessibilityState={{ selected }}
            trailing={
              selected ? (
                <Text style={styles.check} accessibilityElementsHidden>
                  ✓
                </Text>
              ) : null
            }
          >
            <RowTitle>{themePreferenceLabel(option)}</RowTitle>
          </Row>
        );
      })}
    </Sheet>
  );
}

const useStyles = createStyles((color) => ({
  check: { fontSize: 16, fontWeight: '600' as const, color: color.primary.default },
}));
