import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HIT_SLOP_44, elevation, radius, size, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

/**
 * The screen furniture every expense screen shares: the app bar, the FAB, a skeleton
 * block, and the glyph that marks a row as not yet synced.
 *
 * Grouped in one module because each is a handful of lines over the tokens and none of
 * them owns any behaviour. The things that *do* own behaviour - `Row`, `Dialog`,
 * `Snackbar`, `Sheet` - are their own files.
 */

export interface AppBarProps {
  readonly title: string;
  /** Leading slot: a back chevron, or a close `x`. */
  readonly leading?: ReactNode;
  /** Trailing slot: the settings gear, the sync pill, a text action. */
  readonly trailing?: ReactNode;
  /** Centre the title, as the expense form does (`06-expense-form.md` element 2). */
  readonly centred?: boolean;
  /** `elevation.1` once the list below has scrolled past 0 (`04-expense-list.md` 1). */
  readonly elevated?: boolean;
  readonly testID?: string;
}

export function AppBar({
  title,
  leading,
  trailing,
  centred = false,
  elevated = false,
  testID,
}: AppBarProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID={testID}
      // The top inset is additive to the bar's own height, never a substitute for it
      // (`00-foundations.md` §3).
      style={[styles.appBar, { paddingTop: insets.top }, elevated ? elevation[1] : null]}
    >
      <View
        // The bar's own height lives on this layer, the inset on the one above, which is
        // what makes them additive rather than one standing in for the other.
        testID={testID === undefined ? undefined : `${testID}-content`}
        style={styles.appBarContent}
      >
        <View style={styles.appBarSide}>{leading}</View>
        <Text
          style={[styles.appBarTitle, centred ? styles.appBarTitleCentred : null]}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {title}
        </Text>
        <View style={[styles.appBarSide, styles.appBarSideTrailing]}>{trailing}</View>
      </View>
    </View>
  );
}

/** A 44x44 icon button. The glyph is small; the target is not (§8 rule 1). */
export function IconButton({
  icon,
  label,
  onPress,
  size: glyphSize = 24,
  tint: tintOverride,
  testID,
}: {
  readonly icon: keyof typeof Feather.glyphMap;
  readonly label: string;
  readonly onPress: () => void;
  readonly size?: number;
  readonly tint?: string;
  readonly testID?: string;
}) {
  const color = useColors();
  const styles = useStyles();
  const tint = tintOverride ?? color.text.secondary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={HIT_SLOP_44}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.iconButton}
    >
      <Feather name={icon} size={glyphSize} color={tint} />
    </Pressable>
  );
}

/**
 * The floating action button.
 *
 * Sits `space.4` from the trailing edge and `space.4` above the tab bar. The list it
 * floats over carries matching bottom padding, so the last row can always be scrolled
 * clear of it (`04-expense-list.md` §Elements, FAB position).
 */
export function Fab({
  label,
  onPress,
  bottomOffset = 0,
  testID,
}: {
  readonly label: string;
  readonly onPress: () => void;
  /** Height of whatever sits below it - the tab bar on Home, nothing on Categories. */
  readonly bottomOffset?: number;
  readonly testID?: string;
}) {
  const color = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.fab,
        { bottom: insets.bottom + bottomOffset + space[4] },
        { backgroundColor: pressed ? color.primary.pressed : color.primary.default },
      ]}
    >
      <Feather name="plus" size={24} color={color.text.inverse} />
    </Pressable>
  );
}

/**
 * A skeleton block.
 *
 * Deliberately **not animated**: a shimmer would violate Reduce Motion for no gain, and a
 * local SQLite read resolves in a frame or two anyway (`04-expense-list.md` state
 * `loading:first-paint`).
 */
export function SkeletonBlock({
  width,
  height,
  radius: corner = radius.sm,
  testID,
}: {
  readonly width: number | `${number}%`;
  readonly height: number;
  readonly radius?: number;
  readonly testID?: string;
}) {
  const color = useColors();
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: corner, backgroundColor: color.bg.sunken }}
    />
  );
}

/**
 * The pending-sync glyph: `clock`, 14, `warning.default`
 * (`02-offline-and-sync.md` §2).
 *
 * `warning`, never `danger`, and no alert icon: the user did nothing wrong, the phone is
 * just in a tunnel (§2 rule 1). It is decorative here because the row it sits in appends
 * `, not synced yet` to its own composed label.
 */
export function PendingGlyph() {
  const color = useColors();
  return (
    <Feather
      name="clock"
      size={size.syncGlyph}
      color={color.warning.default}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="pending-glyph"
    />
  );
}

/**
 * The `needs-attention` glyph: `alert-circle`, 14, `danger.default` (§5.1).
 *
 * The one place in the row where `danger` is right, and the contrast with
 * {@link PendingGlyph} is the design: a queued change is warning-coloured because nothing
 * is wrong, and a refused one is red because the server has said no and the user has to
 * do something. Decorative, because the row appends `, could not sync` to its own label.
 */
export function NeedsAttentionGlyph() {
  const color = useColors();
  return (
    <Feather
      name="alert-circle"
      size={size.syncGlyph}
      color={color.danger.default}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="needs-attention-glyph"
    />
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    appBar: {
      backgroundColor: color.bg.surface,
    },
    appBarContent: {
      minHeight: size.appBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space[4],
      gap: space[2],
    },
    appBarSide: {
      minWidth: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
    },
    appBarSideTrailing: {
      justifyContent: 'flex-end',
    },
    appBarTitle: {
      ...type.headline,
      color: color.text.primary,
      flex: 1,
    },
    appBarTitleCentred: {
      textAlign: 'center',
    },
    iconButton: {
      minWidth: 24,
      minHeight: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fab: {
      ...elevation[2],
      position: 'absolute',
      right: space[4],
      width: size.fab,
      height: size.fab,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
