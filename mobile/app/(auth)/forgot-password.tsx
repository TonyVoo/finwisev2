import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Email } from '@expense-tracker/shared';
import { presentResetError } from '@/auth/resetErrors';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { TextField } from '@/components/TextField';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Forgot password, step 1: ask for a code (`docs/design/03-auth.md` §4).
 *
 * The server answers `204` whether or not the email has an account, so there is nothing
 * to react to and nothing to leak: on success the app moves on to the code screen either
 * way, and that screen words itself as "if an account exists". Online-only, because the
 * email is sent by the server.
 */
export default function ForgotPasswordScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy) return;
    const parsed = Email.safeParse(email);
    setBanner(null);
    if (!parsed.success) {
      setError(VALIDATION_COPY.email.invalid);
      return;
    }
    setError(undefined);

    setBusy(true);
    try {
      const normalised = parsed.data.toLowerCase();
      await api.forgotPassword({ email: normalised });
      setBusy(false);
      router.push({ pathname: '/(auth)/reset-password', params: { email: normalised } });
    } catch (failure) {
      setBanner(presentResetError(failure, 'forgotPassword').banner);
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={COPY.forgotPassword.title}
      onBack={() => router.back()}
      testID="forgot-password"
      banner={
        banner === null ? null : <FormBanner message={banner} testID="forgot-password-banner" />
      }
    >
      <Text style={styles.hint}>{COPY.forgotPassword.hint}</Text>

      <TextField
        label={COPY.signup.field.email}
        placeholder={COPY.signup.field.emailPlaceholder}
        value={email}
        onChangeText={setEmail}
        error={error}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        testID="forgot-password-email"
      />

      <Button
        label={COPY.forgotPassword.submit}
        onPress={() => void submit()}
        busy={busy}
        fullWidth
        testID="forgot-password-submit"
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
