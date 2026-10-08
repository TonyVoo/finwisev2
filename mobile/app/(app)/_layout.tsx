import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/auth/SessionProvider';

/**
 * The auth gate.
 *
 * `status` is never `loading` here: the root layout holds the splash screen until the
 * session has been read out of secure store, so by the time this renders the answer is
 * known. That is what keeps the gate a single branch instead of a three-way one with a
 * spinner nobody ever sees.
 *
 * The redirect is a `Redirect`, not a `router.replace` in an effect. An effect runs
 * *after* the first paint, so an unauthenticated user would see a frame of Home - and
 * with a session that just expired, a frame of someone else's data.
 */
export default function AppLayout() {
  const { status } = useSession();

  if (status !== 'authenticated') {
    return <Redirect href="/(auth)/welcome" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* Jumping further than a step at a time, per docs/design/05-month-switcher.md. */}
      <Stack.Screen name="month-picker" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
