import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Email, LIMITS } from '@expense-tracker/shared';
import { presentAccountError } from '@/account/accountErrors';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { useSnackbar } from '@/components/Snackbar';
import { TextField } from '@/components/TextField';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useUserEmail } from '@/db/hooks';
import { writeUser } from '@/db/user';
import { queryKeys } from '@/query/keys';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Change email.
 *
 * Online-only like change password: the server checks the password and the address's
 * uniqueness, and neither can be queued. The session is untouched (no token carries the
 * email), so the only local consequence is the user row, which is rewritten from the
 * server's answer so Settings shows the new address at once.
 */
export default function ChangeEmailScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const showSnackbar = useSnackbar();
  const currentEmail = useUserEmail();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): { found: typeof errors; parsed: string | null } {
    const found: typeof errors = {};
    const parsed = Email.safeParse(email);
    // Lowercased as the server does, so "ADA@..." is recognised as the address already held.
    const normalised = parsed.success ? parsed.data.toLowerCase() : null;
    if (normalised === null) found.email = VALIDATION_COPY.email.invalid;
    else if (normalised === currentEmail.data?.toLowerCase()) {
      found.email = COPY.account.changeEmail.same;
    }
    if (password.length === 0) found.password = VALIDATION_COPY.password.empty;
    else if (password.length > LIMITS.PASSWORD_MAX) found.password = VALIDATION_COPY.password.long;
    return { found, parsed: normalised };
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const { found, parsed } = validate();
    setErrors(found);
    setBanner(null);
    if (parsed === null || Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const { user } = await api.changeEmail({ email: parsed, password });
      await writeUser(database, user);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.email() });
      showSnackbar({ message: COPY.account.changeEmail.success });
      router.back();
    } catch (error) {
      const presented = presentAccountError(error, 'changeEmail');
      setErrors({
        ...(presented.passwordError === null ? {} : { password: presented.passwordError }),
        ...(presented.emailError === undefined ? {} : { email: presented.emailError }),
      });
      setBanner(presented.banner);
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={COPY.account.changeEmail.title}
      onBack={() => router.back()}
      testID="change-email"
      banner={banner === null ? null : <FormBanner message={banner} testID="change-email-banner" />}
    >
      <Text style={styles.hint}>{COPY.account.changeEmail.hint}</Text>

      <TextField
        label={COPY.account.changeEmail.new}
        placeholder={COPY.signup.field.emailPlaceholder}
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        autoCorrect={false}
        returnKeyType="next"
        editable={!busy}
        testID="change-email-new"
      />
      <PasswordField
        label={COPY.account.changeEmail.password}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        testID="change-email-password"
      />

      <Button
        label={COPY.account.changeEmail.submit}
        onPress={() => void submit()}
        busy={busy}
        fullWidth
        testID="change-email-submit"
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
