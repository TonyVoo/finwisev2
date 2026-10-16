import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { syncPillA11yLabel, syncPillLabel } from '../copy/strings';
import { HIT_SLOP_44, color, radius, size, space, type } from '../theme/tokens';
import { type SyncInputs, type SyncPillState, isPillTappable, syncPillState } from './state';

/**
 * The sync pill: `docs/design/02-offline-and-sync.md` §3.
 *
 * Presentational on purpose - it takes the engine's four inputs and nothing else, so all
 * six rows of §3's table are reachable in a test without a server, a radio or a clock.
 * What connects it to the engine is {@link SyncIndicator}.
 *
 * Three rules here are easy to implement as something subtly different, so each is
 * written out where it happens:
 *
 * - **State 1 renders nothing** - not an empty pill and not a tick (rule 1). The slot it
 *   sits in keeps its width anyway (rule 7), which is why the empty `View` is still
 *   returned rather than `null`.
 * - **`Syncing…` is suppressed for 800ms** (rule 2), and while suppressed the pill shows
 *   *the state it would be in if nothing were in flight*, not nothing at all. A device
 *   with three queued changes keeps reading `3 pending` through the first 800ms of the
 *   push rather than blanking and coming back.
 * - **The accessibility label is the full sentence**, never the terse one (rule 6).
 */

/** §3 rule 2. Most syncs finish inside this, and then the pill never appears. */
export const SYNCING_VISIBLE_AFTER_MS = 800;

/**
 * The trailing slot's width, so the screen title cannot shift when sync state changes
 * (§3 rule 7).
 *
 * Sized to the widest state, `Offline · 99 pending`: twenty characters of `type.caption` at
 * 12px average a little under 7px each, plus the 14px glyph, the `space.1` gap and
 * `space.2` either side, rounded up. Deliberately a constant rather than an `onLayout`
 * measurement - a slot that sizes itself to its content is precisely the layout shift the
 * rule forbids, and the only label that could exceed it is a five-figure pending count.
 */
export const SYNC_PILL_SLOT_WIDTH = 150;

interface PillStyle {
  readonly glyph: keyof typeof Feather.glyphMap;
  readonly fill: string;
  readonly tint: string;
}

/** §3's table, as styling. `idle` is absent because it has nothing to style. */
const PILL_STYLES: Record<Exclude<SyncPillState, 'idle'>, PillStyle> = {
  syncing: { glyph: 'refresh-cw', fill: color.info.subtle, tint: color.info.default },
  pending: { glyph: 'clock', fill: color.warning.subtle, tint: color.warning.default },
  // State 4 is not an error and is not coloured as one (rule 3): grey, quiet, `bg.sunken`.
  offline: { glyph: 'cloud-off', fill: color.bg.sunken, tint: color.text.secondary },
  'offline-pending': {
    glyph: 'cloud-off',
    fill: color.warning.subtle,
    tint: color.warning.default,
  },
  error: { glyph: 'alert-circle', fill: color.danger.subtle, tint: color.danger.default },
};

export interface SyncPillProps {
  readonly inputs: SyncInputs;
  /** Opens the sync sheet (§4). Only called in states 3-6. */
  readonly onPress: () => void;
  readonly testID?: string;
}

export function SyncPill({ inputs, onPress, testID = 'sync-pill' }: SyncPillProps) {
  const showSyncing = useDelayedSyncing(inputs.inFlight);
  const state = syncPillState({ ...inputs, inFlight: inputs.inFlight && showSyncing });

  const label = syncPillLabel(state, inputs.pendingRecords);
  const a11yLabel = syncPillA11yLabel(state, inputs.pendingRecords);

  if (state === 'idle' || label === null) {
    // Rule 7: the slot keeps its width, so the title does not move when sync state
    // changes. Rule 6: hidden from the accessibility tree, since there is nothing to say.
    return (
      <View
        testID={`${testID}-empty`}
        style={styles.slot}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }

  const tappable = isPillTappable(state);
  const { glyph, fill, tint } = PILL_STYLES[state];

  return (
    <View style={styles.slot}>
      <Pressable
        testID={testID}
        onPress={tappable ? onPress : undefined}
        disabled={!tappable}
        // 44x44 even though the pill is 24 tall (§3, and §8 rule 1).
        hitSlop={HIT_SLOP_44}
        accessibilityRole={tappable ? 'button' : undefined}
        accessibilityLabel={a11yLabel ?? label}
        style={[styles.pill, { backgroundColor: fill }]}
      >
        <SyncGlyph name={glyph} tint={tint} spinning={state === 'syncing'} />
        <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The glyph, rotating only in the syncing state and only when motion is allowed.
 *
 * Reduce Motion gets a still `refresh-cw` rather than a faster one: §4 of
 * `00-foundations.md` collapses durations to 0ms, and no motion in this app carries
 * meaning - the label already says `Syncing…`.
 */
function SyncGlyph({
  name,
  tint,
  spinning,
}: {
  readonly name: keyof typeof Feather.glyphMap;
  readonly tint: string;
  readonly spinning: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!spinning || reduceMotion) return;

    rotation.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, rotation, spinning]);

  const glyph = (
    <Feather
      name={name}
      size={size.syncGlyph}
      color={tint}
      // The pill composes its own label; a second announcement of the icon is noise.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );

  if (!spinning || reduceMotion) return glyph;

  return (
    <Animated.View
      style={{
        transform: [
          { rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    >
      {glyph}
    </Animated.View>
  );
}

/**
 * Whether a sync has been running long enough to admit to (§3 rule 2).
 *
 * The timer is keyed on the transition into flight rather than on a render, so a sync
 * that finishes in 200ms never flips this true and the pill never flickers.
 */
function useDelayedSyncing(inFlight: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!inFlight) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), SYNCING_VISIBLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [inFlight]);

  return visible;
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

const styles = StyleSheet.create({
  slot: {
    width: SYNC_PILL_SLOT_WIDTH,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  pill: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[2],
    borderRadius: radius.pill,
  },
  label: {
    ...type.caption,
  },
});
