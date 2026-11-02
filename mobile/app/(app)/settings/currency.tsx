import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LIMITS } from '@expense-tracker/shared';
import { presentCurrencyChangeError } from '@/account/accountErrors';
import { useApiClient } from '@/bootstrap/AppProviders';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { FormBanner } from '@/components/FormBanner';
import { FormScreen } from '@/components/FormScreen';
import { PasswordField } from '@/components/PasswordField';
import { Row, RowTitle } from '@/components/Row';
import { useSnackbar } from '@/components/Snackbar';
import { TextField } from '@/components/TextField';
import { COPY, VALIDATION_COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useUserCurrency } from '@/db/hooks';
import { countPendingRecords } from '@/db/queries';
import { CurrencySheet } from '@/expenses/CurrencySheet';
import { reconcileDataScope, resetBooksAfterCurrencyChange } from '@/household/dataScope';
import { useSpaces } from '@/household/useSpaces';
import { convertMinor, isValidRate } from '@/lib/conversion';
import { currencyLabel } from '@/lib/currencies';
import { currencyDecimals, formatMoney } from '@/lib/money';
import { queryKeys } from '@/query/keys';
import { useSync } from '@/sync/SyncProvider';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Change the account currency (`docs/design/19-change-currency.md`).
 *
 * The server converts every amount at the rate typed here, in one transaction, so this is
 * online-only and refuses while changes are waiting to sync (they would be in the old currency).
 * Afterwards the phone throws away its copy of the books and syncs them again, rather than
 * merging old and new amounts. The rate is filled in from the market when there is one for the
 * pair; a currency the provider does not price (such as the dong) is typed by hand.
 */

export const CURRENCY_PICK_TEST_ID = 'currency-change-pick';
export const CURRENCY_RATE_TEST_ID = 'currency-change-rate';
export const CURRENCY_EXAMPLE_TEST_ID = 'currency-change-example';
export const CURRENCY_PASSWORD_TEST_ID = 'currency-change-password';
export const CURRENCY_SUBMIT_TEST_ID = 'currency-change-submit';
export const CURRENCY_DIALOG_TEST_ID = 'currency-change-dialog';

type RateNote = 'none' | 'filled' | 'manual';

export default function ChangeCurrencyScreen() {
  const styles = useStyles();
  const router = useRouter();
  const api = useApiClient();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const showSnackbar = useSnackbar();
  const { engine } = useSync();
  const { active } = useSpaces();
  const current = useUserCurrency().data ?? null;

  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [rate, setRate] = useState('');
  const [rateNote, setRateNote] = useState<RateNote>('none');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ currency?: string; rate?: string; password?: string }>({});
  const [banner, setBanner] = useState<string | null>(
    active?.kind === 'household' ? COPY.currencyChange.personalOnly : null,
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // The market rate for the pair, when the provider has one; otherwise the person types it.
  useEffect(() => {
    if (current === null || chosen === null) return;
    let cancelled = false;
    setRate('');
    setRateNote('none');
    api.getRate({ from: current, to: chosen }).then(
      (response) => {
        if (cancelled) return;
        setRate(response.data.rate);
        setRateNote('filled');
      },
      () => {
        if (!cancelled) setRateNote('manual');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, current, chosen]);

  const example =
    current !== null && chosen !== null && isValidRate(rate)
      ? (() => {
          const from = 10 * 10 ** currencyDecimals(current);
          const converted = convertMinor({
            amountMinor: from,
            fromDecimals: currencyDecimals(current),
            toDecimals: currencyDecimals(chosen),
            rate,
          });
          return converted === null
            ? null
            : `${formatMoney(from, current)}  →  ${formatMoney(converted, chosen)}`;
        })()
      : null;

  function review(): void {
    if (busy) return;
    const found: typeof errors = {};
    if (chosen === null) found.currency = COPY.currencyChange.same;
    if (!isValidRate(rate)) found.rate = COPY.currencyChange.rateInvalid;
    if (password.length === 0) found.password = VALIDATION_COPY.password.empty;
    else if (password.length > LIMITS.PASSWORD_MAX) found.password = VALIDATION_COPY.password.long;
    setErrors(found);
    setBanner(active?.kind === 'household' ? COPY.currencyChange.personalOnly : null);
    if (Object.keys(found).length > 0 || active?.kind === 'household') return;
    setConfirming(true);
  }

  async function confirmChange(): Promise<void> {
    setConfirming(false);
    if (chosen === null) return;
    setBusy(true);
    try {
      if ((await countPendingRecords(database)) > 0) {
        setBanner(COPY.currencyChange.syncFirst);
        setBusy(false);
        return;
      }
      const { user } = await api.changeCurrency({ currency: chosen, rate, password });
      await resetBooksAfterCurrencyChange(database, user);
      // The stored list of spaces carries each book's currency, so it is read afresh.
      await reconcileDataScope(database, api);
      await queryClient.invalidateQueries({ queryKey: queryKeys.local() });
      void engine.sync('manual');
      showSnackbar({ message: COPY.currencyChange.success });
      router.back();
    } catch (error) {
      const presented = presentCurrencyChangeError(error);
      setErrors(presented.passwordError === null ? {} : { password: presented.passwordError });
      setBanner(presented.banner);
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={COPY.currencyChange.title}
      onBack={() => router.back()}
      testID="currency-change"
      banner={
        banner === null ? null : <FormBanner message={banner} testID="currency-change-banner" />
      }
    >
      <Text style={styles.hint}>{COPY.currencyChange.intro}</Text>

      <Row
        testID={CURRENCY_PICK_TEST_ID}
        onPress={() => setPicking(true)}
        chevron
        lastInGroup
        accessibilityLabel={`${COPY.currencyChange.to}, ${
          chosen === null ? COPY.currencyChange.pick : currencyLabel(chosen)
        }`}
        trailing={<Text style={styles.value}>{chosen ?? COPY.currencyChange.pick}</Text>}
      >
        <RowTitle>{COPY.currencyChange.to}</RowTitle>
      </Row>
      {errors.currency === undefined ? null : <Text style={styles.error}>{errors.currency}</Text>}

      {chosen === null || current === null ? null : (
        <>
          <TextField
            label={`${COPY.currencyChange.rate} (1 ${current} = ? ${chosen})`}
            value={rate}
            onChangeText={(next) => {
              setRate(next);
              setRateNote('none');
            }}
            helper={
              rateNote === 'filled'
                ? COPY.currencyChange.rateFilled
                : rateNote === 'manual'
                  ? COPY.currencyChange.rateManual
                  : COPY.currencyChange.rateHint
            }
            error={errors.rate}
            keyboardType="decimal-pad"
            autoCorrect={false}
            editable={!busy}
            testID={CURRENCY_RATE_TEST_ID}
          />
          {example === null ? null : (
            <Text style={styles.example} testID={CURRENCY_EXAMPLE_TEST_ID}>
              {COPY.currencyChange.example}: {example}
            </Text>
          )}
        </>
      )}

      <PasswordField
        label={COPY.currencyChange.password}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={review}
        editable={!busy}
        testID={CURRENCY_PASSWORD_TEST_ID}
      />

      <Button
        label={COPY.currencyChange.submit}
        onPress={review}
        busy={busy}
        fullWidth
        testID={CURRENCY_SUBMIT_TEST_ID}
      />

      <CurrencySheet
        visible={picking}
        onClose={() => setPicking(false)}
        selected={chosen ?? ''}
        home={current ?? ''}
        onSelect={(code) => {
          setPicking(false);
          if (code === current) {
            setChosen(null);
            setErrors({ currency: COPY.currencyChange.same });
            return;
          }
          setErrors({});
          setChosen(code);
        }}
      />

      <Dialog
        visible={confirming}
        testID={CURRENCY_DIALOG_TEST_ID}
        title={COPY.currencyChange.dialogTitle}
        body={COPY.currencyChange.dialogBody}
        confirmVariant="primary"
        destructive={{ label: COPY.currencyChange.confirm, onPress: () => void confirmChange() }}
        onCancel={() => setConfirming(false)}
      />
    </FormScreen>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    hint: { ...type.body, color: color.text.secondary, marginBottom: space[2] },
    value: { ...type.body, color: color.text.secondary },
    example: { ...type.footnote, color: color.text.secondary, marginBottom: space[2] },
    error: { ...type.footnote, color: color.danger.default, marginBottom: space[2] },
  }),
);
