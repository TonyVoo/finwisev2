import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/auth/SessionProvider';
import { Button } from '@/components/Button';
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
  const color = useColors();
  const styles = useStyles();
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
        The mark. Feather has no wallet glyph, so `credit-card` stands in - the set is
        fixed at one family by §5 ("one set, no mixing") and a second icon library for a
        single decorative mark is the wrong trade. It carries no label because it says
        nothing the app name does not (§1.1 element 1).
      */}
      <Feather
        name="credit-card"
        size={64}
        color={color.primary.default}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <Text style={styles.name} accessibilityRole="header">
        {COPY.app.name}
      </Text>
      {/* Centred text is used only on this screen, and only for two lines (§1.1
          Accessibility). Body copy everywhere else is leading-aligned. */}
      <Text style={styles.tagline} numberOfLines={2}>
        {COPY.welcome.tagline}
      </Text>

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
