import { InviteCode } from '@expense-tracker/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const JOIN_SHEET_TEST_ID = 'household-join-sheet';
export const JOIN_CODE_TEST_ID = 'household-code';
export const JOIN_SUBMIT_TEST_ID = 'household-join-submit';

/** Enter the code the owner shared. The code is checked for shape here and for truth by the server. */
export function JoinSheet({
  visible,
  error,
  onClose,
  onJoin,
}: {
  readonly visible: boolean;
  /** What the server or the sync check said about the last attempt. */
  readonly error: string | undefined;
  readonly onClose: () => void;
  readonly onJoin: (code: string) => Promise<void>;
}) {
  const styles = useStyles();
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setText('');
      setLocalError(undefined);
    }
  }, [visible]);

  const submit = async () => {
    const parsed = InviteCode.safeParse(text);
    if (!parsed.success) {
      setLocalError(COPY.household.error.invalid_invite_code);
      return;
    }
    setBusy(true);
    try {
      await onJoin(parsed.data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={COPY.household.joinSheet.title}
      onClose={onClose}
      testID={JOIN_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <TextField
          testID={JOIN_CODE_TEST_ID}
          label={COPY.household.joinSheet.field}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setLocalError(undefined);
          }}
          error={localError ?? error}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
        />
        <Text style={styles.hint}>{COPY.household.joinSheet.hint}</Text>
        <Button
          testID={JOIN_SUBMIT_TEST_ID}
          label={COPY.household.joinSheet.submit}
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
