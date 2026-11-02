import { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AppBar, IconButton } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import {
  openPaymentNotificationSettings,
  paymentNotificationsEnabled,
  paymentNotificationsSupported,
} from '@/capture/native';
import { useCapturedLog, useReadCapturedNotifications, useSuggestions } from '@/capture/hooks';
import { guessCategory } from '@/capture/categoryGuess';
import { stashCapture } from '@/capture/pendingCapture';
import { dismiss, localDay, type Suggestion } from '@/capture/store';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { useUserCurrency } from '@/db/hooks';
import { formatMoney } from '@/lib/money';
import { space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';

/**
 * Payment detection (`docs/design/20-payment-detection.md`): the switch (Android's own Notification access
 * screen, which only the person can turn on), the payments the phone has noticed, and a log of what it has
 * read, so a missed payment can be explained. Nothing here becomes an entry until Add is tapped, and Add opens
 * the ordinary Add expense form with the amount, day and name filled in.
 */

export const DETECTION_STATUS_TEST_ID = 'detection-status';
export const DETECTION_TURN_ON_TEST_ID = 'detection-turn-on';
export const SUGGESTION_ROW_TEST_ID_PREFIX = 'suggestion';

export default function PaymentDetectionScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const currency = useUserCurrency().data ?? 'VND';
  const read = useReadCapturedNotifications();
  const suggestions = useSuggestions().data ?? [];
  const log = useCapturedLog().data ?? [];

  const supported = paymentNotificationsSupported();
  const [enabled, setEnabled] = useState(paymentNotificationsEnabled);
  // The person comes back from Android settings, so the answer is asked again whenever the app returns.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setEnabled(paymentNotificationsEnabled());
    });
    return () => subscription.remove();
  }, []);

  const add = useCallback(
    async (item: Suggestion) => {
      if (item.amountMinor === null || item.currency === null || item.direction === null) return;
      const kind = item.direction === 'income' ? 'income' : 'expense';
      stashCapture({
        categoryId: await guessCategory(database, item.counterparty, kind),
        id: item.id,
        kind,
        amountMinor: item.amountMinor,
        currency: item.currency,
        note: item.counterparty,
        date: localDay(item.postTime),
      });
      router.push('/(app)/expense/new');
    },
    [router, database],
  );

  const dismissOne = useCallback(
    async (item: Suggestion) => {
      await dismiss(database, item.id);
      await queryClient.invalidateQueries({ queryKey: ['local', 'capture'] });
    },
    [database, queryClient],
  );

  const title = (item: Suggestion) =>
    item.counterparty ??
    (item.direction === 'income' ? COPY.paymentDetection.received : COPY.paymentDetection.payment);

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.paymentDetection.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="detection-back"
          />
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.body}>
          {supported ? COPY.paymentDetection.intro : COPY.paymentDetection.unsupported}
        </Text>

        {supported ? (
          <View style={styles.block}>
            <Text style={styles.status} testID={DETECTION_STATUS_TEST_ID}>
              {enabled ? COPY.paymentDetection.statusOn : COPY.paymentDetection.statusOff}
            </Text>
            {enabled ? null : (
              <>
                <Button
                  label={COPY.paymentDetection.turnOn}
                  onPress={openPaymentNotificationSettings}
                  fullWidth
                  testID={DETECTION_TURN_ON_TEST_ID}
                />
                <Text style={styles.note}>{COPY.paymentDetection.turnOnHint}</Text>
              </>
            )}
          </View>
        ) : null}

        <Text style={styles.heading} onPress={() => void read()}>
          {COPY.paymentDetection.suggestions}
        </Text>
        {suggestions.length === 0 ? (
          <Text style={styles.note} testID="detection-empty">
            {COPY.paymentDetection.none}
          </Text>
        ) : (
          suggestions.map((item, index) => (
            <View key={item.id}>
              <Row
                testID={`${SUGGESTION_ROW_TEST_ID_PREFIX}-${index}`}
                lastInGroup
                accessibilityLabel={`${title(item)}, ${formatMoney(item.amountMinor ?? 0, item.currency ?? currency)}`}
                trailing={
                  <Text style={styles.amount}>
                    {item.direction === 'income' ? '+' : ''}
                    {formatMoney(item.amountMinor ?? 0, item.currency ?? currency)}
                  </Text>
                }
              >
                <RowTitle>{title(item)}</RowTitle>
                <RowSubtitle lines={2}>
                  {item.duplicate
                    ? `${item.source} · ${COPY.paymentDetection.duplicate}`
                    : item.source}
                </RowSubtitle>
              </Row>
              <View style={styles.actions}>
                <Button
                  label={COPY.paymentDetection.add}
                  onPress={() => void add(item)}
                  testID={`${SUGGESTION_ROW_TEST_ID_PREFIX}-add-${index}`}
                />
                <Button
                  label={COPY.paymentDetection.dismiss}
                  variant="secondary"
                  onPress={() => void dismissOne(item)}
                  testID={`${SUGGESTION_ROW_TEST_ID_PREFIX}-dismiss-${index}`}
                />
              </View>
            </View>
          ))
        )}

        <Text style={styles.heading}>{COPY.paymentDetection.log}</Text>
        <Text style={styles.note}>{COPY.paymentDetection.logHint}</Text>
        {log.length === 0 ? (
          <Text style={styles.note}>{COPY.paymentDetection.logEmpty}</Text>
        ) : (
          log.map((row) => (
            <View key={row.id} style={styles.logRow} testID="detection-log-row">
              <Text style={styles.logMeta}>
                {row.source} · {new Date(row.postTime).toLocaleString()}
                {row.status === 'ignored' ? ` · ${COPY.paymentDetection.ignored}` : ''}
              </Text>
              <Text style={styles.logText}>
                {[row.title, row.body].filter(Boolean).join(' - ')}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    content: { padding: space[4], gap: space[3] },
    body: { ...type.body, color: color.text.secondary },
    block: { gap: space[2] },
    status: { ...type.headline, color: color.text.primary },
    heading: { ...type.headline, color: color.text.primary, marginTop: space[3] },
    note: { ...type.footnote, color: color.text.secondary },
    amount: { ...type.body, color: color.text.primary },
    actions: { flexDirection: 'row', gap: space[2], paddingVertical: space[2] },
    logRow: { gap: 2, paddingVertical: space[1] },
    logMeta: { ...type.footnote, color: color.text.tertiary },
    logText: { ...type.footnote, color: color.text.secondary },
  }),
);
