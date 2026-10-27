import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import type { GoalListItem } from '../db/queries';
import { currencyDecimals } from '../lib/money';
import { space } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { validateDeposit } from './goalModel';

/** The quick action on a goal: how much did you just put aside? */

export const DEPOSIT_SHEET_TEST_ID = 'deposit-sheet';
export const DEPOSIT_AMOUNT_TEST_ID = 'deposit-amount';
export const DEPOSIT_SUBMIT_TEST_ID = 'deposit-submit';
export const DEPOSIT_EDIT_TEST_ID = 'deposit-edit';

export function DepositSheet({
  goal,
  onClose,
  onDeposit,
  onEdit,
}: {
  readonly goal: GoalListItem | null;
  readonly onClose: () => void;
  readonly onDeposit: (amountMinor: number) => Promise<void>;
  readonly onEdit: () => void;
}) {
  const styles = useStyles();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  // A fresh field every time a goal is opened.
  const goalId = goal?.id ?? null;
  useEffect(() => {
    setText('');
    setError(undefined);
  }, [goalId]);

  const submit = () => {
    if (goal === null) return;
    const result = validateDeposit(text, currencyDecimals(goal.currency));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void onDeposit(result.amountMinor);
  };

  return (
    <Sheet
      visible={goal !== null}
      title={COPY.goals.deposit.title.replace('{name}', goal?.name ?? '')}
      onClose={onClose}
      testID={DEPOSIT_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextField
          testID={DEPOSIT_AMOUNT_TEST_ID}
          label={COPY.goals.deposit.amount}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setError(undefined);
          }}
          error={error}
          keyboardType="decimal-pad"
          autoFocus
        />
        <Button
          testID={DEPOSIT_SUBMIT_TEST_ID}
          label={COPY.goals.deposit.add}
          variant="primary"
          fullWidth
          onPress={submit}
        />
        <Button
          testID={DEPOSIT_EDIT_TEST_ID}
          label={COPY.goals.deposit.editGoal}
          variant="ghost"
          fullWidth
          onPress={onEdit}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    body: { gap: space[4], paddingBottom: space[4] },
  }),
);
