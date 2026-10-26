import { type ReactNode, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  PanResponder,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY } from '../copy/strings';
import { HIT_SLOP_44, color, elevation, radius, size, space, type } from '../theme/tokens';

/**
 * The bottom sheet, as `docs/design/00-foundations.md` §6 specifies it.
 *
 * §6 lists **four** ways to dismiss one - grabber drag, scrim tap, the `x`, and Android
 * back - and all four are wired, because they are not alternatives. The `x` is the only
 * one a screen reader user can find; scrim tap is what a thumb reaches for; Android back
 * is the system contract; and the drag is what the grabber visually promises. Drawing a
 * grabber that does not drag is the kind of small lie that teaches users not to trust
 * affordances.
 *
 * The drag uses `PanResponder`, which is in React Native itself. `react-native-reanimated`
 * is in the project and would be smoother, but a 60-line dependency-free implementation
 * that only has to answer "did the user pull down far enough" is the smaller thing to
 * own, and it keeps the sheet usable in the jest environment.
 *
 * **Reduce Motion is honoured by changing the transition, not by shortening it.** §4 says
 * the durations collapse to 0ms and transitions become cross-fades, so the modal's
 * animation switches from `slide` to `fade` rather than sliding faster.
 */

/** How far down the sheet must be pulled before letting go dismisses it. */
const DISMISS_THRESHOLD = 80;

export interface SheetProps {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly testID?: string;
}

export function Sheet({ visible, title, onClose, children, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4,
    onPanResponderMove: (_event, gesture) => {
      // Downward only. Dragging up must not lift the sheet off the bottom of the screen.
      setDragOffset(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      setDragOffset(0);
      if (gesture.dy > DISMISS_THRESHOLD) onClose();
    },
    onPanResponderTerminate: () => setDragOffset(0),
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'fade' : 'slide'}
      // Android's back button. §6 makes it a dismiss, and for a Dialog it resolves as
      // Cancel - never as the destructive action.
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* iOS does not resize a Modal for the keyboard; without this the form's lower fields
          and its Save button sit under it. Android resizes the window itself. */}
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* The scrim. A sibling of the sheet rather than its parent, so a tap on the
            sheet itself cannot bubble up to it and close what the user just touched. */}
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          // Decorative to a screen reader: it has no name worth reading, and the `x`
          // below is the dismiss a screen reader user navigates to.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={testID === undefined ? undefined : `${testID}-scrim`}
        />

        <View
          testID={testID}
          style={[
            styles.sheet,
            { paddingBottom: space[4] + insets.bottom, transform: [{ translateY: dragOffset }] },
          ]}
        >
          <View style={styles.grabberArea} {...panResponder.panHandlers}>
            <View style={styles.grabber} />
          </View>

          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={COPY.common.close}
              hitSlop={HIT_SLOP_44}
              testID={testID === undefined ? undefined : `${testID}-close`}
            >
              <Feather name="x" size={24} color={color.text.primary} />
            </Pressable>
          </View>

          {/* Scrolls rather than clipping: ten currency rows at a large font scale are
              taller than a short phone (§2, no fixed-height containers). */}
          {/* `handled`: with a field focused, the first tap on a button inside the sheet would
              otherwise only dismiss the keyboard, and the form's Save needed two presses. */}
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.bg.scrim,
  },
  sheet: {
    backgroundColor: color.bg.surface,
    // Top corners only: the sheet is anchored to the bottom edge, so rounding the bottom
    // would show the scrim through two notches.
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space[4],
    maxHeight: '85%',
    ...elevation[2],
  },
  grabberArea: {
    // A 36x4 bar is far too small to grab, so the pan area is padded out around it while
    // the bar itself stays the specified size.
    paddingTop: space[2],
    paddingBottom: space[2],
    alignItems: 'center',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: color.border.strong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: size.tapTargetMin,
    gap: space[3],
  },
  title: {
    ...type.title2,
    color: color.text.primary,
    flex: 1,
  },
});
