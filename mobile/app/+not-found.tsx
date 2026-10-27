import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { COPY } from '@/copy/strings';

/**
 * Reachable from a stale deep link or a mistyped `expensetracker://` URL. The way out
 * goes to `/`, so the auth gate decides where that actually lands.
 */
export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: COPY.notFound.headerTitle }} />
      <Text style={styles.title}>{COPY.notFound.title}</Text>
      <Link href="/" style={styles.link}>
        {COPY.notFound.action}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 17, fontWeight: '600' },
  link: { fontSize: 15, textDecorationLine: 'underline' },
});
