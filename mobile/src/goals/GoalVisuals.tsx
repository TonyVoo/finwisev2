import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useReduceMotion } from '../lib/useReduceMotion';
import { radius, space } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

const BAR_HEIGHT = 6;

/**
 * A goal's progress bar. The fill eases to its new width when a deposit lands, and is shown
 * at once on first paint and under Reduce Motion. Decorative: the row's label carries the
 * percentage.
 */
export function GoalBar({
  fill,
  reached,
  testID,
}: {
  readonly fill: number;
  readonly reached: boolean;
  readonly testID: string;
}) {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const width = useRef(new Animated.Value(fill)).current;
  const previous = useRef(fill);

  useEffect(() => {
    if (previous.current === fill) return;
    previous.current = fill;
    if (reduceMotion) {
      width.setValue(fill);
      return;
    }
    // Layout properties cannot use the native driver.
    const animation = Animated.timing(width, {
      toValue: fill,
      duration: 400,
      useNativeDriver: false,
    });
    animation.start();
    // A screen left mid-animation must not keep a timer running behind it.
    return () => animation.stop();
  }, [fill, reduceMotion, width]);

  return (
    <View style={styles.track} testID={testID} accessibilityElementsHidden>
      <Animated.View
        testID={`${testID}-fill`}
        style={[
          styles.fill,
          reached ? styles.fillReached : null,
          { width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
    </View>
  );
}

/** The goal row's leading icon: a target while saving, a check once the target is met. */
export function GoalBadge({ reached }: { readonly reached: boolean }) {
  const color = useColors();
  const styles = useStyles();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: reached ? color.success.subtle : color.primary.subtle },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Feather
        testID={reached ? 'goal-badge-check' : 'goal-badge-target'}
        name={reached ? 'check' : 'target'}
        size={16}
        color={reached ? color.success.default : color.primary.default}
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    track: {
      height: BAR_HEIGHT,
      borderRadius: BAR_HEIGHT / 2,
      backgroundColor: color.border.hairline,
      overflow: 'hidden',
      marginTop: space[2],
    },
    fill: { height: BAR_HEIGHT, backgroundColor: color.primary.default },
    fillReached: { backgroundColor: color.success.default },
    badge: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
