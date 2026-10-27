import { StyleSheet, Text } from 'react-native';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { createStyles } from '../theme/ThemeProvider';
import { type } from '../theme/tokens';
import { LANGUAGE_PREFERENCES, type LanguagePreference } from './language';
import { useLanguage } from './LanguageProvider';

/**
 * The language choice: three rows, the current one ticked, applied at once.
 *
 * Like the theme sheet there is no Save button to forget: the screen behind it changes as it
 * dismisses, which is its own confirmation. The two language names are written in their own
 * language in both bundles (`English`, `Tiếng Việt`), so someone who has ended up in a
 * language they cannot read can still find the way back.
 */

export const LANGUAGE_SHEET_TEST_ID = 'language-sheet';
export const LANGUAGE_OPTION_TEST_ID_PREFIX = 'language-option';

export function languagePreferenceLabel(preference: LanguagePreference): string {
  return COPY.language[preference];
}

export function LanguageSheet({
  visible,
  onClose,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
}) {
  const { preference, setPreference } = useLanguage();
  const styles = useStyles();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={COPY.language.title}
      testID={LANGUAGE_SHEET_TEST_ID}
    >
      {LANGUAGE_PREFERENCES.map((option, index) => {
        const selected = option === preference;
        return (
          <Row
            key={option}
            testID={`${LANGUAGE_OPTION_TEST_ID_PREFIX}-${option}`}
            onPress={() => {
              setPreference(option);
              onClose();
            }}
            lastInGroup={index === LANGUAGE_PREFERENCES.length - 1}
            accessibilityLabel={languagePreferenceLabel(option)}
            accessibilityState={{ selected }}
            trailing={
              selected ? (
                <Text style={styles.check} accessibilityElementsHidden>
                  ✓
                </Text>
              ) : null
            }
          >
            <RowTitle>{languagePreferenceLabel(option)}</RowTitle>
          </Row>
        );
      })}
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    check: { ...type.bodyStrong, color: color.primary.default },
  }),
);
