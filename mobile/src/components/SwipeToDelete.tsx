import { type ReactNode, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { color, motion, space, type } from '../theme/tokens';

/**
 * A row with a destructive action revealed by a leading-to-trailing swipe
 * (`docs/design/04-expense-list.md` element 16 and rule 7).
 *
 * Built on `PanResponder` and `Animated`, both in React Native itself, rather than on
 * `react-native-gesture-handler`'s swipeable. The gesture here has one question to answer
 * - "did the release land past half the row" - and owning sixty lines of it means the row
 * is renderable under jest, where gesture-handler's native module and reanimated's
 * worklets runtime are not. `src/components/Sheet.tsx` took the same decision for the
 * same reason.
 *
 * **The gesture is not the only path to delete**, and must never be: it is invisible to a
 * screen reader. The row also exposes a `delete` accessibility action, and Delete is
 * reachable from the expense form (§Accessibility rule 3). This component renders the
 * gesture; the row above it owns the action.
 */

/** Width of the revealed action. `04-expense-list.md` element 16: at least 64. */
const ACTION_WIDTH = 96;

/**
 * Whether releasing at `translation` commits the delete.
 *
 * Rule 7: "releasing past 50% of the row width commits", and a partial swipe springs back.
 * Pure and exported so the threshold is tested as arithmetic rather than by synthesising a
 * gesture - the thing most likely to be silently wrong here is the sign of the comparison,
 * not the animation.
 *
 * @param translation how far the row has moved, negative for a leading-to-trailing swipe.
 * @param rowWidth the row's measured width. Zero before layout, which commits nothing.
 */
export function releaseCommits(translation: number, rowWidth: number): boolean {
  if (rowWidth <= 0) return false;
  return -translation >= rowWidth / 2;
}

export interface SwipeToDeleteProps {
  readonly children: ReactNode;
  readonly onDelete: () => void;
  /** Copy on the revealed action. `Delete` on both screens that use this. */
  readonly actionLabel: string;
  /** Disable the gesture - the `isDefault` category row has no swipe action at all. */
  readonly enabled?: boolean;
  readonly testID?: string;
}

export function SwipeToDelete({
  children,
  onDelete,
  actionLabel,
  enabled = true,
  testID,
}: SwipeToDeleteProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const [rowWidth, setRowWidth] = useState(0);

  const settle = (to: number): void => {
    offset.current = to;
    Animated.timing(translateX, {
      toValue: to,
      duration: motion.fast.duration,
      useNativeDriver: true,
    }).start();
  };

  const responder = useRef(
    PanResponder.create({
      // Horizontal intent only, so a vertical drag still scrolls the list underneath.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        enabled && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) => {
        // Trailing-to-leading drags past the resting position are ignored: there is no
        // leading action, so a row never moves right of where it started.
        const next = Math.min(0, offset.current + gesture.dx);
        translateX.setValue(next);
      },
      onPanResponderRelease: (_event, gesture) => {
        const next = Math.min(0, offset.current + gesture.dx);
        if (releaseCommits(next, rowWidth)) {
          onDelete();
          settle(0);
          return;
        }
        // Past the action's width but not past half the row: hold the action open, which
        // is the state the tappable `Delete` exists for.
        settle(next <= -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0);
      },
      onPanResponderTerminate: () => settle(0),
    }),
  ).current;

  return (
    <View
      testID={testID}
      style={styles.container}
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
    >
      <Pressable
        // The action carries no accessible name on purpose (see below), so a test that
        // wants to tap it has nothing to query it by. Same reasoning as
        // `ROW_CHEVRON_TEST_ID`.
        testID={testID === undefined ? undefined : `${testID}-action`}
        style={styles.action}
        onPress={() => {
          settle(0);
          onDelete();
        }}
        // Not exposed to screen readers: the row's own `delete` accessibility action is
        // that path, and announcing this one would offer the same action twice
        // (§Accessibility rule 3).
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Feather name="trash-2" size={20} color={color.text.inverse} />
        <Text style={styles.actionLabel}>{actionLabel}</Text>
      </Pressable>

      <Animated.View
        style={[styles.row, { transform: [{ translateX }] }]}
        {...(enabled ? responder.panHandlers : {})}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: color.danger.default,
  },
  action: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
  },
  actionLabel: {
    ...type.caption,
    color: color.text.inverse,
  },
  row: {
    backgroundColor: color.bg.surface,
  },
});
