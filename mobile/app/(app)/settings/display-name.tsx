import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@expense-tracker/shared';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { useSnackbar } from '@/components/Snackbar';
import { TextField } from '@/components/TextField';
import { NetworkUnavailableError } from '@/api/errors';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useUserDisplayName } from '@/db/hooks';
import { readUser, writeUser } from '@/db/user';
import { queryKeys } from '@/query/keys';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Display name: what other people in a household see for this account, in place of the start of
 * the email. Optional - emptying the field clears it.
 *
 * Online-only like the other account edits, but with no password: a name is not a credential.
 * The local user row is rewritten from the server's answer, so Settings and the household
 * labels show the new name at once.
 */
export default function DisplayNameScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const showSnackbar = useSnackbar();
  const current = useUserDisplayName();

  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from what is saved, once it has been read - and only once, so a late read cannot
  // overwrite what the person has already started typing.
  useEffect(() => {
    if (loaded || current.isPending) return;
    setName(current.data ?? '');
    setLoaded(true);
  }, [loaded, current.isPending, current.data]);

  async function save(): Promise<void> {
    if (busy) return;
    const trimmed = name.trim();
    setBanner(null);
    if (trimmed.length > LIMITS.DISPLAY_NAME_MAX) {
      setError(COPY.account.displayName.tooLong);
      return;
    }
    setError(undefined);

    setBusy(true);
    try {
      const { user } = await api.updateProfile({ displayName: trimmed === '' ? null : trimmed });
      // Merge onto the stored row: the answer is the account's own, and so is the row.
      if ((await readUser(database)) !== null) await writeUser(database, user);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.displayName() });
      showSnackbar({ message: COPY.account.displayName.saved });
      router.back();
    } catch (failure) {
      setBanner(
        failure instanceof NetworkUnavailableError
          ? COPY.account.displayName.offline
          : COPY.error.generic,
      );
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={COPY.account.displayName.title}
      onBack={() => router.back()}
      testID="display-name"
      banner={banner === null ? null : <FormBanner message={banner} testID="display-name-banner" />}
    >
      <Text style={styles.hint}>{COPY.account.displayName.hint}</Text>

      <TextField
        label={COPY.account.displayName.field}
        value={name}
        onChangeText={(next) => {
          setName(next);
          setError(undefined);
        }}
        error={error}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        editable={!busy}
        testID="display-name-input"
      />

      <Button
        label={COPY.account.displayName.save}
        onPress={() => void save()}
        busy={busy}
        fullWidth
        testID="display-name-save"
      />
    </FormScreen>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    hint: {
      ...type.body,
      color: color.text.secondary,
      marginBottom: space[2],
    },
  }),
);
