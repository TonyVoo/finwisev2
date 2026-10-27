import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApiClient } from '@/bootstrap/AppProviders';
import { useAuthForm } from '@/auth/useAuthForm';
import { validateLogin } from '@/auth/validation';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { TextField } from '@/components/TextField';
import { COPY } from '@/copy/strings';

/**
 * Log in - `docs/design/03-auth.md` §1.3.
 *
 * Nearly the same screen as signup, and the differences are all deliberate:
 *
 * - **No currency field** (fixed at signup) and **no "Forgot password?"** link
 *   (`01-flows.md` §6).
 * - **Validation is presence only** (§1.3 rule 1). This screen never checks email format
 *   or password length. Rejecting a credential the server might accept locks a user out
 *   of their own account, and refusing a short password hints at the shape of the stored
 *   one.
 * - **`invalid_credentials` is a form-level banner, never a field error** (§1.3 rule 2),
 *   and the copy never says which half was wrong. A field-level error on Email would
 *   confirm whether an account exists. Both of those live in
 *   `src/auth/authErrors.ts`, so this screen only has to render what it is handed.
 *
 * Arriving from signup's `Log in instead` link carries the typed email, and focus starts
 * on Password - the one field still needed (§1.3 States).
 */
export default function LoginScreen() {
  const router = useRouter();
  const api = useApiClient();
  const params = useLocalSearchParams<{ email?: string }>();
  const prefilledEmail = params.email ?? '';

  const form = useAuthForm({
    screen: 'login',
    validate: validateLogin,
    request: (credentials) => api.login(credentials),
    initialEmail: prefilledEmail,
  });
  const { state } = form;

  useEffect(() => {
    // Only when the email arrived prefilled. On a normal visit the first field is the
    // one to start in, and auto-focusing Password there would skip over Email.
    if (prefilledEmail.length > 0) form.fieldRefs.password.current?.focus();
    // Keyed on the prefilled address alone: it runs once per arrival, and `form` is
    // rebuilt every render while the ref objects inside it stay stable.
  }, [prefilledEmail]);

  return (
    <FormScreen
      title={COPY.login.title}
      onBack={() => router.back()}
      testID="login"
      banner={
        state.banner === null ? null : <FormBanner message={state.banner} testID="login-banner" />
      }
    >
      <TextField
        label={COPY.signup.field.email}
        placeholder={COPY.signup.field.emailPlaceholder}
        value={state.values.email}
        onChangeText={(value) => form.setField('email', value)}
        onBlur={() => form.blurField('email')}
        error={state.errors.email}
        inputRef={form.fieldRefs.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        autoCorrect={false}
        returnKeyType="next"
        onSubmitEditing={() => form.fieldRefs.password.current?.focus()}
        submitBehavior="submit"
        editable={!form.busy}
        testID="login-email"
      />

      <PasswordField
        label={COPY.signup.field.password}
        value={state.values.password}
        onChangeText={(value) => form.setField('password', value)}
        onBlur={() => form.blurField('password')}
        error={state.errors.password}
        inputRef={form.fieldRefs.password}
        // `current-password`, not `new-password`: this is where a password manager should
        // offer an existing credential rather than generate one.
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={form.submit}
        editable={!form.busy}
        testID="login-password"
      />

      <Button
        label={COPY.login.submit}
        onPress={form.submit}
        busy={form.busy}
        fullWidth
        testID="login-submit"
      />
      <Button
        label={COPY.login.forgot}
        variant="ghost"
        onPress={() => router.push('/(auth)/forgot-password')}
        fullWidth
        testID="login-forgot"
      />
    </FormScreen>
  );
}
