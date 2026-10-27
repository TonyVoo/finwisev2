import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { COPY } from '@/copy/strings';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { installForegroundHandler } from '@/notifications/budgetNotifier';
import { AppProviders } from '@/bootstrap/AppProviders';
import { type AppContainer, createAppContainer } from '@/bootstrap/container';
import {
  ThemeProvider,
  applyThemePreference,
  createStyles,
  useColors,
  useTheme,
} from '@/theme/ThemeProvider';

/**
 * The root route: build the app container, then render the tree.
 *
 * Both halves of the container gate the first frame, and both are fast and local:
 * opening SQLite and running migrations, and reading the session out of secure store.
 * Holding the splash screen until they finish is what lets every screen below assume a
 * migrated database and a settled session - so `(app)` can redirect on "no session"
 * without a third "we do not know yet" state to design for, and no screen needs a
 * "database not ready" branch.
 *
 * Note what is *not* awaited here: anything on the network. A cold start on a plane
 * reaches the expense list just as fast as one on wifi, which is the point of the whole
 * architecture (`docs/PLAN.md` §Mobile).
 */

installForegroundHandler();

// Fire-and-forget: if the splash screen is already gone this rejects, and that is not
// worth crashing a launch over.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [container, setContainer] = useState<AppContainer | null>(null);
  const [bootError, setBootError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    createAppContainer().then(
      (ready) => {
        // Before the first frame, so a pinned theme never flashes the system one.
        applyThemePreference(ready.themePreference);
        if (!cancelled) setContainer(ready);
      },
      (error: unknown) => {
        if (!cancelled) {
          setBootError(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (container !== null || bootError !== null) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [container, bootError]);

  if (bootError !== null) {
    // A failure here means a migration or the secure store broke, not that the user is
    // offline. There is no retry that would help, so say so plainly rather than looping.
    return (
      <SafeAreaProvider>
        <ThemeProvider>
          <BootError message={bootError.message} />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  // Splash screen is still up; rendering nothing avoids a flash of an unguarded route.
  if (container === null) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <AppProviders container={container}>
        <ThemedStatusBar />
        <ThemedRoot>
          <Slot />
        </ThemedRoot>
      </AppProviders>
    </SafeAreaProvider>
  );
}

/** Icons contrast with whichever palette is showing, including after a live switch. */
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

/** The backdrop behind every route, so a screen transition never shows the navigator's white. */
function ThemedRoot({ children }: { readonly children: ReactNode }) {
  const color = useColors();
  return <View style={{ flex: 1, backgroundColor: color.bg.canvas }}>{children}</View>;
}

function BootError({ message }: { readonly message: string }) {
  const styles = useStyles();
  return (
    <View style={styles.boot}>
      <Text style={styles.bootTitle}>{COPY.boot.title}</Text>
      <Text style={styles.bootDetail}>{message}</Text>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    boot: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 24,
      backgroundColor: color.bg.canvas,
    },
    bootTitle: {
      color: color.text.primary,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    bootDetail: {
      color: color.text.primary,
      fontSize: 13,
      opacity: 0.7,
      textAlign: 'center',
    },
  }),
);
