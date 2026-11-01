import { HouseholdName } from '@expense-tracker/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { LIMITS } from '@expense-tracker/shared';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const NAME_SHEET_TEST_ID = 'household-name-sheet';
export const NAME_FIELD_TEST_ID = 'household-name';
export const NAME_SUBMIT_TEST_ID = 'household-name-submit';

/**
 * Name a household: when making one (`mode: 'create'`, with a line saying what will happen), and when the
 * owner renames it. The length limit is enforced by refusing the keystroke, so no error is needed for it; a
 * blank name is the only thing left to refuse.
 */
export function NameSheet({
  visible,
  mode,
  initial,
  error,
  onClose,
  onSubmit,
}: {
  readonly visible: boolean;
  readonly mode: 'create' | 'rename';
  /** The name to start from: the current one when renaming. */
  readonly initial: string;
  /** What the server or the sync check said about the last attempt. */
  readonly error: string | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => Promise<void>;
}) {
  const styles = useStyles();
  const [text, setText] = useState(initial);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setText(initial);
      setLocalError(undefined);
    }
  }, [visible, initial]);

  const submit = async () => {
    const parsed = HouseholdName.safeParse(text);
    if (!parsed.success) {
      setLocalError(COPY.household.nameSheet.empty);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={
        mode === 'create'
          ? COPY.household.nameSheet.createTitle
          : COPY.household.nameSheet.renameTitle
      }
      onClose={onClose}
      testID={NAME_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextField
          testID={NAME_FIELD_TEST_ID}
          label={COPY.household.nameSheet.field}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setLocalError(undefined);
          }}
          error={localError ?? error}
          maxLength={LIMITS.HOUSEHOLD_NAME_MAX}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {mode === 'create' ? (
          <Text style={styles.hint}>{COPY.household.nameSheet.createHint}</Text>
        ) : null}
        <Button
          testID={NAME_SUBMIT_TEST_ID}
          label={
            mode === 'create' ? COPY.household.nameSheet.create : COPY.household.nameSheet.save
          }
          variant="primary"
          fullWidth
          busy={busy}
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[4], paddingBottom: space[4] },
    hint: { ...type.callout, color: color.text.secondary },
  }),
);
