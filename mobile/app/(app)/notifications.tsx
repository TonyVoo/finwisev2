import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AppBar, IconButton } from '@/components/Chrome';
import { EmptyIcon } from '@/components/EmptyIcon';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { SectionTitle } from '@/components/Card';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { fillTemplate, formatDong } from '@/invest/investModel';
import { nextBuyDate } from '@/invest/dca';
import { dateRowLabel } from '@/lib/calendar';
import { useSelectedMonth } from '@/month/MonthProvider';
import { goBack } from '@/navigation/goBack';
import { INBOX_QUERY_KEY } from '@/notifications/NotificationBell';
import { markSeen, readInbox } from '@/notifications/inbox';
import { SymbolAvatar } from '@/invest/SymbolAvatar';
import { createStyles, useColors } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

export const NOTIFICATIONS_EMPTY_TEST_ID = 'notifications-empty';
export const NOTIFICATIONS_OFF_TEST_ID = 'notifications-off';
export const NOTIFICATIONS_ALLOW_TEST_ID = 'notifications-allow';
export const NOTIFICATIONS_ALERT_PREFIX = 'notifications-alert';
export const NOTIFICATIONS_PLAN_PREFIX = 'notifications-plan';

type Permission = 'unknown' | 'granted' | 'askable' | 'blocked';

/**
 * The notifications screen: the price alerts that fired and the plans coming up, with a prompt to allow notifications
 * when they are off - the usual reason an alert fires and nothing is seen. Opening it marks everything as seen, which
 * clears the bell's count.
 */
export default function NotificationsScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const database = useDatabase();
  const queryClient = useQueryClient();
  const { today } = useSelectedMonth();
  const inbox = useQuery({
    queryKey: [...INBOX_QUERY_KEY, 'screen'],
    queryFn: () => readInbox(database),
  });
  const [permission, setPermission] = useState<Permission>('unknown');

  const checkPermission = useCallback(async () => {
    const current = await Notifications.getPermissionsAsync();
    setPermission(current.granted ? 'granted' : current.canAskAgain ? 'askable' : 'blocked');
  }, []);
  useEffect(() => {
    void checkPermission().catch(() => undefined);
  }, [checkPermission]);

  // What is on screen is what was seen: the count clears once it has been read.
  useEffect(() => {
    if (inbox.data === undefined) return;
    void markSeen(database, new Date()).then(() =>
      queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY }),
    );
  }, [inbox.data, database, queryClient]);

  async function allow(): Promise<void> {
    if (permission === 'blocked') {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    await Notifications.requestPermissionsAsync();
    await checkPermission();
  }

  const data = inbox.data;
  const empty = data !== undefined && data.fired.length === 0 && data.plans.length === 0;

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.notifications.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => goBack(router, '/(app)/(tabs)')}
            tint={color.text.primary}
            testID="notifications-back"
          />
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        {permission === 'askable' || permission === 'blocked' ? (
          <Card testID={NOTIFICATIONS_OFF_TEST_ID}>
            <View style={styles.off}>
              <Text style={styles.offTitle}>{COPY.notifications.offTitle}</Text>
              <Text style={styles.muted}>{COPY.notifications.offBody}</Text>
              <Button
                testID={NOTIFICATIONS_ALLOW_TEST_ID}
                label={
                  permission === 'blocked'
                    ? COPY.notifications.openSettings
                    : COPY.notifications.allow
                }
                variant="primary"
                fullWidth
                onPress={() => void allow()}
              />
            </View>
          </Card>
        ) : null}

        {data !== undefined && data.fired.length > 0 ? (
          <>
            <SectionTitle>{COPY.notifications.priceAlerts}</SectionTitle>
            <Card>
              {data.fired.map((alert, index) => (
                <Row
                  key={alert.id}
                  testID={`${NOTIFICATIONS_ALERT_PREFIX}-${alert.id}`}
                  leading={<SymbolAvatar symbol={alert.symbol} />}
                  lastInGroup={index === data.fired.length - 1}
                >
                  <RowTitle>
                    {fillTemplate(COPY.notifications.alertRow, {
                      symbol: alert.symbol,
                      price: formatDong(alert.firedPrice ?? alert.price),
                    })}
                  </RowTitle>
                  <RowSubtitle>
                    {`${fillTemplate(COPY.notifications.alertDetail, {
                      direction:
                        alert.direction === 'above'
                          ? COPY.notifications.above
                          : COPY.notifications.below,
                      target: formatDong(alert.price),
                    })} · ${(alert.firedAt ?? '').slice(0, 10)}`}
                  </RowSubtitle>
                </Row>
              ))}
            </Card>
          </>
        ) : null}

        {data !== undefined && data.plans.length > 0 ? (
          <>
            <SectionTitle>{COPY.notifications.comingUp}</SectionTitle>
            <Card>
              {data.plans.map((plan, index) => (
                <Row
                  key={plan.id}
                  testID={`${NOTIFICATIONS_PLAN_PREFIX}-${plan.id}`}
                  leading={<SymbolAvatar symbol={plan.symbol} />}
                  lastInGroup={index === data.plans.length - 1}
                >
                  <RowTitle>
                    {fillTemplate(COPY.notifications.planRow, {
                      symbol: plan.symbol,
                      amount: formatDong(plan.amount),
                    })}
                  </RowTitle>
                  <RowSubtitle>{dateRowLabel(nextBuyDate(plan, today), today)}</RowSubtitle>
                </Row>
              ))}
            </Card>
          </>
        ) : null}

        {empty ? (
          <View style={styles.empty} testID={NOTIFICATIONS_EMPTY_TEST_ID}>
            <EmptyIcon name="bell" />
            <Text style={styles.muted}>{COPY.notifications.empty}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = createStyles((color, { display }) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    content: { gap: space[3], paddingTop: space[3], paddingBottom: space[6] },
    off: { padding: space[4], gap: space[3] },
    offTitle: { ...type.headline, ...display('semibold'), color: color.text.primary },
    muted: { ...type.callout, color: color.text.secondary, textAlign: 'left' },
    empty: { padding: space[6], gap: space[3], alignItems: 'center' },
  }),
);
