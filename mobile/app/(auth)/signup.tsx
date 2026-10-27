import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useApiClient } from '@/bootstrap/AppProviders';
import { useAuthForm } from '@/auth/useAuthForm';
import { validateSignup } from '@/auth/validation';
import { Button } from '@/components/Button';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { markCategoryReviewPending } from '@/db/onboarding';
import { queryKeys } from '@/query/keys';
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY_CODE,
  currencyAccessibilityLabel,
  currencyLabel,
} from '@/lib/currencies';
import { HIT_SLOP_44, radius, size, space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';

/**
 * Sign up - `docs/design/03-auth.md` §1.2.
 *
 * One of the two screens in the app that genuinely wait on the network. Three decisions
 * here are worth reading the spec for rather than guessing at:
 *
 * - **Submit is enabled from the first frame**, before anything is typed (§1.2 rule 1).
 *   Tapping it on an empty form runs validation and reveals the errors. A button
 *   disabled until the form is valid leaves the user tapping a dead control with no way
 *   to find out what is wrong - which is why `Button` has no `disabled` prop to reach
 *   for here.
 * - **Currency cannot be changed later**, so the helper text says so under the select
 *   rather than leaving the user to discover it in Settings. It also decides the amount
 *   keypad's decimal places for the life of the account (`JPY` has none), which is why
 *   the list is fixed and not a search (§1.2 rules 8 and 9).
 * - **The password is never cleared** on any error (§1.2 rule 10). Clearing it on a
 *   failed attempt is a punishment for a typo in a different field.
 *
 * What this screen does *not* do is navigate on success. `useAuthForm` adopts the
 * session; the `(auth)` layout's guard redirects an authenticated user to the app. One
 * place decides where a signed-in user lands.
 */
export default function SignupScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY_CODE);
  const [pickerOpen, setPickerOpen] = useState(false);

  const database = useDatabase();
  const queryClient = useQueryClient();

  const form = useAuthForm({
    screen: 'signup',
    // After the session is adopted: the new account's categories were seeded for it, and
    // Home offers to show them once (`db/onboarding.ts`).
    onSignedIn: async () => {
      await markCategoryReviewPending(database);
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.categoryReview() });
    },
    validate: validateSignup,
    request: ({ email, password }) => api.signup({ email, password, currency }),
  });
  const { state } = form;

  return (
    <FormScreen
      title={COPY.signup.title}
      onBack={() => router.back()}
      testID="signup"
      banner={
        state.banner === null ? null : <FormBanner message={state.banner} testID="signup-banner" />
      }
    >
      <View>
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
          // Moves to Password rather than dismissing the keyboard (§1.2 Accessibility).
          onSubmitEditing={() => form.fieldRefs.password.current?.focus()}
          submitBehavior="submit"
          editable={!form.busy}
          testID="signup-email"
        />

        {/*
          §1.2 rule 4: offered directly below the Email helper when the address is already
          registered, carrying the typed email so only the password is needed. A ghost
          link rather than a second primary action - the user came here to sign up, and
          this is a correction, not the main path.
        */}
        {state.offerLogin ? (
          <Pressable
            onPress={() =>
              router.replace({
                pathname: '/(auth)/login',
                params: { email: state.values.email },
              })
            }
            accessibilityRole="link"
            accessibilityLabel={COPY.signup.loginInstead}
            hitSlop={HIT_SLOP_44}
            style={styles.loginInstead}
            testID="signup-login-instead"
          >
            <Text style={styles.loginInsteadLabel}>{COPY.signup.loginInstead}</Text>
          </Pressable>
        ) : null}
      </View>

      <PasswordField
        label={COPY.signup.field.password}
        value={state.values.password}
        onChangeText={(value) => form.setField('password', value)}
        onBlur={() => form.blurField('password')}
        error={state.errors.password}
        helper={COPY.signup.field.passwordHint}
        inputRef={form.fieldRefs.password}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={form.submit}
        editable={!form.busy}
        testID="signup-password"
      />

      <View>
        <Text style={styles.label}>{COPY.signup.field.currency}</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={currencyAccessibilityLabel(currency, COPY.signup.field.currency)}
          accessibilityHint={COPY.signup.field.currencyHint}
          style={styles.select}
          testID="signup-currency"
        >
          <Text style={styles.selectValue}>{currencyLabel(currency)}</Text>
          <Feather name="chevron-down" size={20} color={color.text.tertiary} />
        </Pressable>
        <Text style={styles.hint}>{COPY.signup.field.currencyHint}</Text>
      </View>

      <Button
        label={COPY.signup.submit}
        onPress={form.submit}
        busy={form.busy}
        fullWidth
        testID="signup-submit"
      />

      <Sheet
        visible={pickerOpen}
        title={COPY.signup.field.currency}
        onClose={() => setPickerOpen(false)}
        testID="currency-sheet"
      >
        {CURRENCY_OPTIONS.map((option) => {
          const selected = option.code === currency;
          return (
            <Pressable
              key={option.code}
              onPress={() => {
                setCurrency(option.code);
                setPickerOpen(false);
              }}
              accessibilityRole="button"
              // The hyphen in the visible label is dropped for the reader, which would
              // otherwise say "USD minus US Dollar".
              accessibilityLabel={`${option.code} ${option.name}`}
              accessibilityState={{ selected }}
              style={styles.option}
              testID={`currency-${option.code}`}
            >
              <Text style={styles.optionLabel}>{`${option.code} - ${option.name}`}</Text>
              {/* The trailing check is a visual confirmation; `accessibilityState`
                  above is what a screen reader reads. */}
              {selected ? <Feather name="check" size={20} color={color.primary.default} /> : null}
            </Pressable>
          );
        })}
      </Sheet>
    </FormScreen>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    label: {
      ...type.subhead,
      color: color.text.secondary,
      marginBottom: space[2],
    },
    select: {
      minHeight: size.inputHeight,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.border.input,
      backgroundColor: color.bg.surface,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space[3],
      paddingVertical: space[3],
      gap: space[3],
    },
    selectValue: {
      ...type.body,
      color: color.text.primary,
      flex: 1,
    },
    hint: {
      ...type.footnote,
      color: color.text.tertiary,
      marginTop: space[1],
    },
    loginInstead: {
      alignSelf: 'flex-start',
      minHeight: size.tapTargetMin,
      justifyContent: 'center',
    },
    loginInsteadLabel: {
      ...type.bodyStrong,
      color: color.primary.default,
    },
    option: {
      minHeight: size.rowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space[3],
      paddingVertical: space[3],
    },
    optionLabel: {
      ...type.body,
      color: color.text.primary,
      flex: 1,
    },
  }),
);
