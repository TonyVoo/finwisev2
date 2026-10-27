import { useEffect } from 'react';
import type { ColorTokens } from '../theme/tokens';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { radius, space, type } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';

/**
 * The form-level banner: what a screen says when a failure belongs to no single field.
 *
 * Two tones, and the difference is not decorative. `danger` is a failure the user has to
 * act on - a wrong password, a server fault, an attempt made with no connectivity.
 * `info` is a statement of fact that is nobody's fault, which in this app is exactly one
 * message: the session expired while they were away (`docs/design/03-auth.md` §1.1
 * States). Rendering that one in red would blame the user for the passage of time.
 *
 * **It announces itself.** A banner that appears above the form is invisible to a screen
 * reader user whose focus is on the Submit button they just pressed, so the message is
 * pushed to the accessibility service on mount and on every change -
 * `accessibilityLiveRegion` covers Android, `announceForAccessibility` covers both
 * platforms (`03-auth.md` §1.3 Accessibility).
 */

export type BannerTone = 'danger' | 'info';

/**
 * The leading `alert-circle`, which only the `danger` tone carries.
 *
 * Exported so a test can assert its presence and its absence. The glyph is decorative to
 * a screen reader - the banner reads as one sentence - so there is no accessible name to
 * find it by, and querying by component type would pin the test to the icon library
 * rather than to the rule.
 */
export const BANNER_ICON_TEST_ID = 'form-banner-icon';

export interface FormBannerProps {
  readonly message: string;
  readonly tone?: BannerTone;
  readonly testID?: string;
}

const tonesFor = (
  color: ColorTokens,
): Readonly<Record<BannerTone, { readonly fill: string; readonly ink: string }>> => ({
  danger: { fill: color.danger.subtle, ink: color.danger.default },
  info: { fill: color.info.subtle, ink: color.info.default },
});

export function FormBanner({ message, tone = 'danger', testID }: FormBannerProps) {
  const color = useColors();
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  const palette = tonesFor(color)[tone];

  return (
    <View
      testID={testID}
      style={[styles.banner, { backgroundColor: palette.fill }]}
      accessibilityLiveRegion="polite"
      // One node, not two: the icon is decorative and the text carries the whole message,
      // so a screen reader reads one sentence rather than "image, alert circle" first.
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      {/* Colour is never the sole carrier of meaning (`00-foundations.md` §8 rule 4), so
          the danger tone pairs its red with a glyph. */}
      {tone === 'danger' ? (
        <Feather
          testID={BANNER_ICON_TEST_ID}
          name="alert-circle"
          size={16}
          color={palette.ink}
          style={styles.icon}
        />
      ) : null}
      <Text style={[styles.message, { color: palette.ink }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.md,
    padding: space[3],
    flexDirection: 'row',
    // Leading-aligned rather than centred: the message can wrap to two lines, and a
    // centred glyph would then float beside the middle of the sentence.
    alignItems: 'flex-start',
  },
  icon: {
    marginRight: space[2],
    // Nudges the 16px glyph onto the first line's optical centre (footnote line height
    // is 18).
    marginTop: 1,
  },
  message: {
    ...type.footnote,
    flex: 1,
  },
});
