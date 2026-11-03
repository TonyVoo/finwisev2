import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/auth/SessionProvider';
import { AppMark } from '@/components/AppMark';
import { Button } from '@/components/Button';
import { FadeInUp } from '@/components/FadeInUp';
import { FormBanner } from '@/components/FormBanner';
import { COPY } from '@/copy/strings';
import { space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';

/**
 * Welcome - `docs/design/03-auth.md` §1.1.
 *
 * "Give a first-time user the two doors in and nothing else." Which is why there is no
 * offline banner and no sync pill here even when the device has no connection: a user
 * with no account has nothing to sync, and warning them about connectivity before they
 * have tried anything is noise. Offline is surfaced on the attempt, where it is
 * actionable.
 *
 * The expired-session notice is the one piece of state this screen has, and §1.1 rule 4
 * is specific about what it must not do: a cold launch that simply has no token shows no
 * banner. The user was not kicked out, they are just not logged in, and claiming
 * otherwise is a lie. That distinction is carried by `SessionSnapshot.expired`, which is
 * only set when a refresh was actually rejected.
 */
export default function WelcomeScreen() {
  const styles = useStyles();
  const color = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { expired } = useSession();
  // §1.1: the banner is "dismissed when the user taps either CTA". Local, because the
  // user dismissing a notice is not a change to the session.
  const [dismissed, setDismissed] = useState(false);

  function go(href: '/(auth)/signup' | '/(auth)/login') {
    setDismissed(true);
    router.push(href);
  }

  return (
    <View
      style={[
        styles.screen,
        { paddingTop: space[16] + insets.top, paddingBottom: space[4] + insets.bottom },
      ]}
    >
      {expired && !dismissed ? (
        // Above the app name, and first in the focus order (§1.1 Accessibility).
        <View style={styles.banner}>
          <FormBanner message={COPY.session.expired} tone="info" testID="session-expired" />
        </View>
      ) : null}

      {/*
        The mark: the app's own receipt-with-a-check, the same drawing as the icon and splash. It is
        the logo rather than a glyph from the icon set, so it is not bound by §5's "one set" rule.
        It carries no label because it says nothing the app name does not (§1.1 element 1).
      */}
      <FadeInUp style={styles.hero}>
        <View
          testID="welcome-mark"
          style={styles.mark}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <AppMark height={64} />
        </View>

        <Text style={styles.name} accessibilityRole="header">
          {COPY.app.name}
        </Text>
        {/* Centred text is used only on this screen, and only for two lines (§1.1
            Accessibility). Body copy everywhere else is leading-aligned. */}
        <Text style={styles.tagline} numberOfLines={2}>
          {COPY.welcome.tagline}
        </Text>
      </FadeInUp>

      {/* What the app is, in three lines, in the space that used to be empty. */}
      <FadeInUp style={styles.features}>
        {(
          [
            ['wifi-off', COPY.welcome.features.offline],
            ['camera', COPY.welcome.features.receipts],
            ['users', COPY.welcome.features.share],
          ] as const
        ).map(([icon, text]) => (
          <View key={icon} style={styles.feature}>
            <View style={styles.featureIcon}>
              <Feather name={icon} size={18} color={color.primary.default} />
            </View>
            <Text style={styles.featureText}>{text}</Text>
          </View>
        ))}
      </FadeInUp>

      <View style={styles.spacer} />

      <View style={styles.actions}>
        <Button
          label={COPY.welcome.cta.signup}
          onPress={() => go('/(auth)/signup')}
          fullWidth
          testID="welcome-signup"
        />
        <Button
          label={COPY.welcome.cta.login}
          variant="secondary"
          onPress={() => go('/(auth)/login')}
          fullWidth
          testID="welcome-login"
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: color.bg.canvas,
      paddingHorizontal: space[4],
      alignItems: 'center',
    },
    banner: {
      alignSelf: 'stretch',
      marginBottom: space[6],
    },
    hero: { alignItems: 'center' },
    mark: {
      width: 112,
      height: 112,
      borderRadius: 56,
      backgroundColor: color.primary.subtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      ...type.title1,
      color: color.text.primary,
      textAlign: 'center',
      marginTop: space[12],
    },
    tagline: {
      ...type.body,
      color: color.text.secondary,
      textAlign: 'center',
      marginTop: space[3],
    },
    features: {
      alignSelf: 'stretch',
      gap: space[3],
      marginTop: space[10],
      paddingHorizontal: space[2],
    },
    feature: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    featureIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: color.primary.subtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureText: { ...type.body, color: color.text.secondary, flex: 1 },
    spacer: {
      flex: 1,
      // A floor, so the two CTAs do not ride up into the tagline on a short screen at a
      // large font scale.
      minHeight: space[8],
    },
    actions: {
      alignSelf: 'stretch',
      gap: space[3],
    },
  }),
);
