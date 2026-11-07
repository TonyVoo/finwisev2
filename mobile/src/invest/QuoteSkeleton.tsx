import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Card } from '../components/Card';
import { SkeletonBlock } from '../components/Chrome';
import { useReduceMotion } from '../lib/useReduceMotion';
import { space } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * What the quote card will look like, drawn grey and breathing while it loads: the screen keeps its shape, so
 * nothing jumps when the answer arrives, and a slow service reads as working rather than stuck. Still under
 * Reduce Motion.
 */

export const QUOTE_SKELETON_TEST_ID = 'invest-skeleton';

export function QuoteSkeleton() {
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.8);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Card>
      <Animated.View testID={QUOTE_SKELETON_TEST_ID} style={[styles.body, { opacity: pulse }]}>
        <View style={styles.top}>
          <SkeletonBlock width={44} height={44} radius={22} />
          <View style={styles.name}>
            <SkeletonBlock width={90} height={16} />
            <SkeletonBlock width={130} height={12} />
          </View>
        </View>
        <SkeletonBlock width="55%" height={36} radius={8} />
        <SkeletonBlock width={80} height={24} radius={12} />
        <SkeletonBlock width="100%" height={132} radius={8} />
        <SkeletonBlock width="100%" height={28} radius={14} />
      </Animated.View>
    </Card>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    body: { padding: space[5], gap: space[3] },
    top: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    name: { gap: space[2] },
  }),
);
