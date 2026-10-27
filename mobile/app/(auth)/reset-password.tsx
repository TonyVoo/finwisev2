import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LIMITS } from '@expense-tracker/shared';
import { presentResetError } from '@/auth/resetErrors';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { useSnackbar } from '@/components/Snackbar';
import { TextField } from '@/components/TextField';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Forgot password, step 2: the code and the new password (`docs/design/03-auth.md` §4).
 *
 * A wrong, expired or used code is a field error on Code - one sentence for all three,
 * because the server does not say which. Success is not a sign-in: every session of the
 * account was ended by the reset, so the app goes back to Log in with the email filled in
 * and a snackbar saying so.
 */
export default function ResetPasswordScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const showSnackbar = useSnackbar();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ code?: string; password?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): typeof errors {
    const found: typeof errors = {};
    // The pattern the server enforces, so a typo is caught before a round trip - and
    // before it could spend one of the code's five attempts.
    if (!new RegExp(`^\\d{${LIMITS.RESET_CODE_LENGTH}}$`).test(code)) {
      found.code = COPY.resetPassword.invalidCode;
    }
    if (password.length < LIMITS.PASSWORD_MIN) found.password = VALIDATION_COPY.password.short;
    else if (password.length > LIMITS.PASSWORD_MAX) found.password = VALIDATION_COPY.password.long;
    return found;
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const found = validate();
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await api.resetPassword({ email, code, newPassword: password });
      showSnackbar({ message: COPY.resetPassword.success });
      router.replace({ pathname: '/(auth)/login', params: { email } });
    } catch (failure) {
      const presented = presentResetError(failure, 'resetPassword');
      setErrors(presented.codeError === null ? {} : { code: presented.codeError });
      setBanner(presented.banner);
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    if (busy) return;
    setBanner(null);
    setBusy(true);
    try {
      await api.forgotPassword({ email });
      showSnackbar({ message: COPY.resetPassword.resent });
    } catch (failure) {
      setBanner(presentResetError(failure, 'forgotPassword').banner);
    }
    setBusy(false);
  }

  return (
    <FormScreen
      title={COPY.resetPassword.title}
      onBack={() => router.back()}
      testID="reset-password"
      banner={
        banner === null ? null : <FormBanner message={banner} testID="reset-password-banner" />
      }
    >
      <Text style={styles.hint}>{COPY.resetPassword.hint.replace('{email}', email)}</Text>

      <TextField
        label={COPY.resetPassword.code}
        value={code}
        onChangeText={(value) =>
          setCode(value.replace(/\D/g, '').slice(0, LIMITS.RESET_CODE_LENGTH))
        }
        error={errors.code}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoCorrect={false}
        returnKeyType="next"
        editable={!busy}
        testID="reset-password-code"
      />
      <PasswordField
        label={COPY.resetPassword.newPassword}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        testID="reset-password-new"
      />

      <Button
        label={COPY.resetPassword.submit}
        onPress={() => void submit()}
        busy={busy}
        fullWidth
        testID="reset-password-submit"
      />
      <Button
        label={COPY.resetPassword.resend}
        variant="ghost"
        onPress={() => void resend()}
        fullWidth
        testID="reset-password-resend"
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
