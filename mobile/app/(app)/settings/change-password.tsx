import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { LIMITS } from '@expense-tracker/shared';
import { presentAccountError } from '@/account/accountErrors';
import { useSessionController } from '@/auth/SessionProvider';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { useSnackbar } from '@/components/Snackbar';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Change password.
 *
 * Online-only by nature: the server has to check the current password and revoke the
 * account's other sessions, and neither can be queued. Everything else follows the auth
 * forms - errors on the field the user can fix, a banner for the rest.
 *
 * On success the server hands back a fresh token pair (every refresh token of the account
 * was revoked, including this device's), and it is installed with `adoptTokenPair`. Skipping
 * that would leave this device holding a revoked refresh token that fails the next time the
 * access token expires, signing the user out an hour after they changed their password.
 */
export default function ChangePasswordScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const session = useSessionController();
  const showSnackbar = useSnackbar();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): typeof errors {
    const found: typeof errors = {};
    if (current.length === 0) found.current = VALIDATION_COPY.password.empty;
    if (next.length < LIMITS.PASSWORD_MIN) found.next = VALIDATION_COPY.password.short;
    else if (next.length > LIMITS.PASSWORD_MAX) found.next = VALIDATION_COPY.password.long;
    else if (next === current) found.next = COPY.account.changePassword.same;
    if (confirm !== next) found.confirm = COPY.account.changePassword.mismatch;
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
      const pair = await api.changePassword({ currentPassword: current, newPassword: next });
      await session.adoptTokenPair(pair);
      showSnackbar({ message: COPY.account.changePassword.success });
      router.back();
    } catch (error) {
      const presented = presentAccountError(error, 'changePassword');
      setErrors(presented.passwordError === null ? {} : { current: presented.passwordError });
      setBanner(presented.banner);
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={COPY.account.changePassword.title}
      onBack={() => router.back()}
      testID="change-password"
      banner={
        banner === null ? null : <FormBanner message={banner} testID="change-password-banner" />
      }
    >
      <Text style={styles.hint}>{COPY.account.changePassword.hint}</Text>

      <PasswordField
        label={COPY.account.changePassword.current}
        value={current}
        onChangeText={setCurrent}
        error={errors.current}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="next"
        editable={!busy}
        testID="change-password-current"
      />
      <PasswordField
        label={COPY.account.changePassword.new}
        value={next}
        onChangeText={setNext}
        error={errors.next}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        editable={!busy}
        testID="change-password-new"
      />
      <PasswordField
        label={COPY.account.changePassword.confirm}
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        editable={!busy}
        testID="change-password-confirm"
      />

      <Button
        label={COPY.account.changePassword.submit}
        onPress={() => void submit()}
        busy={busy}
        fullWidth
        testID="change-password-submit"
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
