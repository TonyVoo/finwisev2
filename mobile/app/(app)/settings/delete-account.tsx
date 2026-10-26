import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { presentAccountError } from '@/account/accountErrors';
import { useSessionController } from '@/auth/SessionProvider';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { color, space, type } from '@/theme/tokens';

/**
 * Delete account.
 *
 * Two deliberate speed bumps, because nothing here can be undone: the password is
 * re-entered (a stolen unlocked phone should not be enough), and a dialog asks once more
 * after the password is typed.
 *
 * On success the server has already destroyed the account, so the local copy is all that is
 * left. `signOut` is exactly the right finish: it forgets the tokens, wipes the database
 * (including any unsynced changes, which have nowhere left to go) and the auth gate
 * redirects to Welcome. Its best-effort server revoke is harmless - logout is idempotent and
 * the token is already dead.
 *
 * A failure leaves everything as it was: the account exists and so does the local data.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const api = useApiClient();
  const session = useSessionController();

  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  function review(): void {
    if (busy) return;
    setBanner(null);
    if (password.length === 0) {
      setPasswordError(VALIDATION_COPY.password.empty);
      return;
    }
    setPasswordError(undefined);
    setConfirming(true);
  }

  async function confirmDelete(): Promise<void> {
    setConfirming(false);
    setBusy(true);
    try {
      await api.deleteAccount({ password });
      await session.signOut();
    } catch (error) {
      const presented = presentAccountError(error, 'deleteAccount');
      setPasswordError(presented.passwordError ?? undefined);
      setBanner(presented.banner);
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={COPY.account.deleteAccount.title}
      onBack={() => router.back()}
      testID="delete-account"
      banner={
        banner === null ? null : <FormBanner message={banner} testID="delete-account-banner" />
      }
    >
      <Text style={styles.warning}>{COPY.account.deleteAccount.warning}</Text>

      <PasswordField
        label={COPY.account.deleteAccount.password}
        value={password}
        onChangeText={setPassword}
        error={passwordError}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={review}
        editable={!busy}
        testID="delete-account-password"
      />

      <Button
        label={COPY.account.deleteAccount.submit}
        variant="destructive"
        onPress={review}
        busy={busy}
        fullWidth
        testID="delete-account-submit"
      />

      <Dialog
        visible={confirming}
        testID="delete-account-dialog"
        title={COPY.account.deleteAccount.dialogTitle}
        body={COPY.account.deleteAccount.dialogBody}
        destructive={{
          label: COPY.account.deleteAccount.confirm,
          onPress: () => void confirmDelete(),
        }}
        onCancel={() => setConfirming(false)}
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  warning: {
    ...type.body,
    color: color.text.secondary,
    marginBottom: space[2],
  },
});
