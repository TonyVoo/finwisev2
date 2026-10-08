import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/auth/SessionProvider';

/**
 * The public half of the app: Welcome, Sign up, Log in.
 *
 * Guarded in the opposite direction to `(app)`. A signed-in user who somehow lands here
 * - a deep link, a stale back stack - is sent to Home rather than being shown a login
 * form for a session they already have.
 */
export default function AuthLayout() {
  const { status } = useSession();

  if (status === 'authenticated') {
    return <Redirect href="/(app)/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
