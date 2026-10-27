import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { SYNC_COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { useOptionalSyncStatus } from './SyncProvider';

/**
 * `Catching up` - the 90-day takeover, `docs/design/02-offline-and-sync.md` §5.3.
 *
 * The **one** full-screen blocking state in the app, and it blocks for a concrete reason
 * rather than a stylistic one: the local database is being deleted and refilled, so there
 * is nothing for a screen to read mid-wipe. Everything else in this app renders from
 * SQLite on the first frame, which is why this is the only overlay of its kind.
 *
 * Two things it does not say and one it cannot show:
 *
 * - **The copy never says "resync", "cursor", "horizon" or "wiped".** The user's mental
 *   model is "my expenses"; the mechanism is not their problem.
 * - **It never apologises.** Nothing has gone wrong - the client's cursor is simply older
 *   than the server's tombstone horizon.
 * - **The bar is indeterminate, because the protocol has no total to be determinate
 *   about.** `GET /v1/sync` answers with `hasMore`, not with a page count or a row count,
 *   so a determinate bar here would be a number the client invented. §5.3 allows either
 *   and asks for a determinate one "when `hasMore` allows a page estimate"; it does not.
 *   Raised as a possible contract addition rather than faked.
 */

export function ResyncOverlay() {
  const status = useOptionalSyncStatus();

  // Mounted only while the wipe-and-refill is running, so nothing below it is asked to
  // read a database that is mid-rebuild. `null` is a tree with no engine in it - see
  // `useOptionalSyncStatus` - where there is by definition no resync to report.
  if (status === null || !status.resyncing) return null;

  return <CatchingUp pages={status.resyncProgress?.pages ?? 0} />;
}

function CatchingUp({ pages }: { readonly pages: number }) {
  const color = useColors();
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const { title, body } = SYNC_COPY.resync;

  useEffect(() => {
    // §5.3: announced on appear, and again on completion - which is the unmount of this
    // component, so the second announcement belongs to the cleanup.
    AccessibilityInfo.announceForAccessibility(title);
    return () => {
      AccessibilityInfo.announceForAccessibility(title);
    };
  }, [title]);

  useEffect(() => {
    if (reduceMotion) return;

    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep]);

  return (
    <View
      style={styles.screen}
      // Not dismissible, and opaque to the accessibility tree: the tree underneath is
      // being rebuilt and must not be reachable by a swipe or a screen-reader focus move.
      accessibilityViewIsModal
      testID="resync-overlay"
    >
      <Feather
        name="refresh-cw"
        size={32}
        color={color.primary.default}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        // No `accessibilityValue`: an indeterminate bar that claimed a percentage would be
        // making one up. `pages` is carried for the testID alone, as evidence the overlay
        // is watching real progress rather than a timer.
        testID={`resync-progress-${pages}`}
      >
        <Animated.View
          style={[
            styles.bar,
            reduceMotion
              ? null
              : {
                  transform: [
                    {
                      translateX: sweep.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-BAR_WIDTH, TRACK_WIDTH],
                      }),
                    },
                  ],
                },
          ]}
        />
      </View>
    </View>
  );
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

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

  return reduceMotion;
}

const TRACK_WIDTH = 200;
const BAR_WIDTH = 80;

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: color.bg.canvas,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[3],
      paddingHorizontal: space[6],
    },
    title: {
      ...type.title2,
      color: color.text.primary,
      textAlign: 'center',
    },
    body: {
      ...type.callout,
      color: color.text.secondary,
      textAlign: 'center',
    },
    track: {
      width: TRACK_WIDTH,
      height: 4,
      marginTop: space[2],
      borderRadius: radius.pill,
      backgroundColor: color.bg.sunken,
      overflow: 'hidden',
    },
    bar: {
      width: BAR_WIDTH,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: color.primary.default,
    },
  }),
);
