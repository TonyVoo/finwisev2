import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY } from '../copy/strings';
import { HIT_SLOP_44, color, size, space, type } from '../theme/tokens';

/**
 * The shell both auth forms sit in: a back-only app bar, a large title, and a scroll
 * view that keeps the keyboard off the submit button.
 *
 * That last part is the reason this is a component rather than copied markup. §1.2
 * Accessibility requires that "the keyboard must not cover the Submit button", which
 * needs a `KeyboardAvoidingView` *outside* a `ScrollView` with the right `behavior` per
 * platform and the right `contentContainerStyle` - a combination that is easy to get
 * subtly wrong and impossible to notice on a simulator with a hardware keyboard. Written
 * once, both screens inherit it.
 *
 * The app bar carries no title (§1.2 Layout): the large title below it is the screen's
 * heading, and repeating it in the bar would have a screen reader read it twice.
 */

export interface FormScreenProps {
  readonly title: string;
  readonly onBack: () => void;
  /** The form-level banner, rendered directly after the title (§1.2 focus order). */
  readonly banner?: ReactNode;
  readonly children: ReactNode;
  readonly testID?: string;
}

export function FormScreen({ title, onBack, banner, children, testID }: FormScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID={testID}>
      <View style={styles.appBar}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={COPY.common.back}
          // `chevron-left` is one of the four glyphs §5 allows to stand alone, and it
          // still carries a label.
          hitSlop={HIT_SLOP_44}
          testID={testID === undefined ? undefined : `${testID}-back`}
        >
          <Feather name="chevron-left" size={24} color={color.text.primary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        // `padding` on iOS and `height` on Android is the pairing that actually works:
        // Android resizes the window itself when `adjustResize` is set, so `padding`
        // there double-counts the keyboard and leaves a gap.
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: space[6] + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {banner}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg.canvas,
  },
  flex: {
    flex: 1,
  },
  appBar: {
    minHeight: size.appBarHeight,
    justifyContent: 'center',
    // The screen gutter is `space.4` on both edges, always (§3).
    paddingHorizontal: space[4],
  },
  content: {
    paddingHorizontal: space[4],
    // Deliberately no `gap`: the spacing below the title is `space.6` and between fields
    // is `space.4`, so one uniform stack gap would be wrong for one of them. Each child
    // owns its own spacing instead.
    gap: space[4],
  },
  title: {
    ...type.title1,
    color: color.text.primary,
    // `space.6` below the title, per both screens' Layout block. `space.4` of it comes
    // from the stack gap, so only the remainder is added here.
    marginBottom: space[6] - space[4],
  },
});
