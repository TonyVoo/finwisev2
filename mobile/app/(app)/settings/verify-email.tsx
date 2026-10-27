import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@expense-tracker/shared';
import { presentVerifyError } from '@/account/accountErrors';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { useSnackbar } from '@/components/Snackbar';
import { TextField } from '@/components/TextField';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useUserEmail } from '@/db/hooks';
import { writeUser } from '@/db/user';
import { queryKeys } from '@/query/keys';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Verify email: enter the 6-digit code mailed to the account's address.
 *
 * Online-only. Verification is optional, so nothing here blocks the app; the screen is
 * reached from a Settings row that only exists while the address is unverified. Success
 * rewrites the local user row from the server's answer so that row disappears at once.
 */
export default function VerifyEmailScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const showSnackbar = useSnackbar();
  const email = useUserEmail();

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy) return;
    setBanner(null);
    // The server's pattern, so a typo is caught before it can spend one of the five attempts.
    if (!new RegExp(`^\\d{${LIMITS.RESET_CODE_LENGTH}}$`).test(code)) {
      setCodeError(COPY.verifyEmail.invalidCode);
      return;
    }
    setCodeError(undefined);

    setBusy(true);
    try {
      const { user } = await api.confirmEmailVerification({ code });
      await writeUser(database, user);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.emailVerified() });
      showSnackbar({ message: COPY.verifyEmail.success });
      router.back();
    } catch (failure) {
      const presented = presentVerifyError(failure, 'confirm');
      setCodeError(presented.codeError ?? undefined);
      setBanner(presented.banner);
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    if (busy) return;
    setBanner(null);
    setBusy(true);
    try {
      await api.requestEmailVerification({});
      showSnackbar({ message: COPY.verifyEmail.resent });
    } catch (failure) {
      setBanner(presentVerifyError(failure, 'request').banner);
    }
    setBusy(false);
  }

  return (
    <FormScreen
      title={COPY.verifyEmail.title}
      onBack={() => router.back()}
      testID="verify-email"
      banner={banner === null ? null : <FormBanner message={banner} testID="verify-email-banner" />}
    >
      <Text style={styles.hint}>{COPY.verifyEmail.hint.replace('{email}', email.data ?? '')}</Text>

      <TextField
        label={COPY.verifyEmail.code}
        value={code}
        onChangeText={(value) =>
          setCode(value.replace(/\D/g, '').slice(0, LIMITS.RESET_CODE_LENGTH))
        }
        error={codeError}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        testID="verify-email-code"
      />

      <Button
        label={COPY.verifyEmail.submit}
        onPress={() => void submit()}
        busy={busy}
        fullWidth
        testID="verify-email-submit"
      />
      <Button
        label={COPY.verifyEmail.resend}
        variant="ghost"
        onPress={() => void resend()}
        fullWidth
        testID="verify-email-resend"
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
