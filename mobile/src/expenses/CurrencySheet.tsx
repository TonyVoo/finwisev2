import { StyleSheet, Text } from 'react-native';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { CURRENCY_OPTIONS, currencyLabel } from '../lib/currencies';
import { createStyles } from '../theme/ThemeProvider';
import { type } from '../theme/tokens';

/**
 * Which currency was this paid in? The same closed list signup offers: a code the app has
 * never rendered would format wrongly, and a rate can only be looked up for a known pair.
 * The account's own currency is first and selected by default, so an ordinary expense never
 * has to open this.
 */

export const CURRENCY_SHEET_TEST_ID = 'expense-currency-sheet';
export const CURRENCY_OPTION_TEST_ID_PREFIX = 'expense-currency-option';

export function CurrencySheet({
  visible,
  onClose,
  selected,
  home,
  onSelect,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly selected: string;
  /** The account currency, listed first. */
  readonly home: string;
  readonly onSelect: (code: string) => void;
}) {
  const styles = useStyles();
  const options = [
    ...CURRENCY_OPTIONS.filter((option) => option.code === home),
    ...CURRENCY_OPTIONS.filter((option) => option.code !== home),
  ];
  return (
    <Sheet
      visible={visible}
      title={COPY.form.currency.title}
      onClose={onClose}
      testID={CURRENCY_SHEET_TEST_ID}
    >
      {options.map((option, index) => (
        <Row
          key={option.code}
          testID={`${CURRENCY_OPTION_TEST_ID_PREFIX}-${option.code}`}
          onPress={() => onSelect(option.code)}
          lastInGroup={index === options.length - 1}
          accessibilityLabel={currencyLabel(option.code)}
          accessibilityState={{ selected: option.code === selected }}
          trailing={
            option.code === selected ? (
              <Text style={styles.check} accessibilityElementsHidden>
                ✓
              </Text>
            ) : null
          }
        >
          <RowTitle>{currencyLabel(option.code)}</RowTitle>
        </Row>
      ))}
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    check: { ...type.bodyStrong, color: color.primary.default },
  }),
);
