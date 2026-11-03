import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { budgetInputText, parseBudgetInput } from '../categories/budgetInput';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY, VALIDATION_COPY } from '../copy/strings';
import { space } from '../theme/tokens';

export const LIMIT_SHEET_TEST_ID = 'limit-sheet';
export const LIMIT_FIELD_TEST_ID = 'limit-field';
export const LIMIT_SAVE_TEST_ID = 'limit-save';
export const LIMIT_REMOVE_TEST_ID = 'limit-remove';

/** Sets or clears the overall monthly limit. Typed text, judged by the same rules as a category budget. */
export function MonthlyLimitSheet({
  visible,
  onClose,
  limitMinor,
  decimals,
  onSave,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly limitMinor: number | null;
  /** Of the account currency. */
  readonly decimals: number;
  readonly onSave: (next: number | null) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!visible) return;
    setText(budgetInputText(limitMinor, decimals));
    setError(undefined);
  }, [visible, limitMinor, decimals]);

  async function save(): Promise<void> {
    const parsed = parseBudgetInput(text, decimals);
    if (parsed.kind === 'invalid') {
      setError(VALIDATION_COPY.category.budgetFormat);
      return;
    }
    await onSave(parsed.kind === 'amount' ? parsed.amountMinor : null);
    onClose();
  }

  return (
    <Sheet
      visible={visible}
      title={COPY.monthlyLimit.sheetTitle}
      onClose={onClose}
      testID={LIMIT_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextField
          testID={LIMIT_FIELD_TEST_ID}
          label={COPY.monthlyLimit.field}
          placeholder={COPY.monthlyLimit.placeholder}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setError(undefined);
          }}
          error={error}
          keyboardType="decimal-pad"
        />
        <Button
          label={COPY.monthlyLimit.save}
          onPress={() => void save()}
          fullWidth
          testID={LIMIT_SAVE_TEST_ID}
        />
        {limitMinor === null ? null : (
          <Button
            label={COPY.monthlyLimit.remove}
            variant="ghost"
            onPress={() => {
              void onSave(null).then(onClose);
            }}
            fullWidth
            testID={LIMIT_REMOVE_TEST_ID}
          />
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({ body: { gap: space[3], paddingBottom: space[2] } });
