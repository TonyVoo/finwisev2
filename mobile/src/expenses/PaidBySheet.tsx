import { ScrollView, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Row, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { useColors } from '../theme/ThemeProvider';

export const PAID_BY_SHEET_TEST_ID = 'paid-by-sheet';

export interface PaidByOption {
  readonly userId: string;
  readonly label: string;
}

/**
 * Who paid, chosen from the household's members (`docs/design/12-settle-up.md`). Like the
 * category picker, tapping a row selects and dismisses: the choice is the confirmation.
 */
export function PaidBySheet({
  visible,
  onClose,
  options,
  selectedId,
  onSelect,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly options: readonly PaidByOption[];
  readonly selectedId: string | null;
  readonly onSelect: (userId: string) => void;
}) {
  const color = useColors();
  return (
    <Sheet
      visible={visible}
      title={COPY.form.paidBy.title}
      onClose={onClose}
      testID={PAID_BY_SHEET_TEST_ID}
    >
      <ScrollView style={styles.list}>
        {options.map((option, index) => {
          const selected = option.userId === selectedId;
          return (
            <Row
              key={option.userId}
              testID={`paid-by-option-${option.userId}`}
              onPress={() => onSelect(option.userId)}
              lastInGroup={index === options.length - 1}
              accessibilityLabel={option.label}
              // State as well as the glyph: a check mark is only a visual cue.
              accessibilityState={{ selected }}
              trailing={
                selected ? <Feather name="check" size={20} color={color.primary.default} /> : null
              }
            >
              <RowTitle>{option.label}</RowTitle>
            </Row>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 360 },
});
