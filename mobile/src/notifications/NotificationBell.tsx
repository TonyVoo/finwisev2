import Feather from '@expo/vector-icons/Feather';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { useDatabase } from '../db/DatabaseProvider';
import { HIT_SLOP_44 } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { readInbox } from './inbox';

export const BELL_TEST_ID = 'home-notifications';
export const BELL_BADGE_TEST_ID = 'home-notifications-badge';
export const INBOX_QUERY_KEY = ['local', 'notifications'] as const;

/** The bell on Home: opens the notifications screen, with a count of what fired since it was last opened. */
export function NotificationBell() {
  const router = useRouter();
  const database = useDatabase();
  const color = useColors();
  const styles = useStyles();
  // Alerts are written to the device's settings, which nothing invalidates, so it looks again now and then.
  const inbox = useQuery({
    queryKey: INBOX_QUERY_KEY,
    queryFn: () => readInbox(database),
    refetchInterval: 30_000,
  });
  const unread = inbox.data?.unread ?? 0;
  return (
    <Pressable
      testID={BELL_TEST_ID}
      onPress={() => router.push('/(app)/notifications')}
      hitSlop={HIT_SLOP_44}
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0
          ? COPY.notifications.openNew.replace('{count}', String(unread))
          : COPY.notifications.open
      }
      style={styles.button}
    >
      <Feather name="bell" size={24} color={color.text.secondary} />
      {unread > 0 ? (
        <View style={styles.badge} testID={BELL_BADGE_TEST_ID}>
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    button: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
    badge: {
      position: 'absolute',
      top: 4,
      right: 2,
      minWidth: 16,
      height: 16,
      paddingHorizontal: 4,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: color.danger.default,
    },
    badgeText: { color: color.text.inverse, fontSize: 10, lineHeight: 12, fontWeight: '700' },
  }),
);
