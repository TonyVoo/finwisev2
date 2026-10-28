import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { categoryIcon } from '../categories/categoryIcon';
import { displayCategoryColor, radius, size, space, type } from '../theme/tokens';
import { createStyles, useColors, useTheme } from '../theme/ThemeProvider';

/**
 * The row, as `docs/design/00-foundations.md` §6 specifies it.
 *
 * "A 56-tall (minimum) `bg.surface` touchable" - and **56 is a floor, not a height**. Every
 * row in this app grows with its content and with the OS font scale, so the style sets
 * `minHeight` and never `height`. A fixed-height row is the single most common way a
 * Dynamic Type setting turns a legible screen into a clipped one (§2).
 *
 * The separator is inset to the content's leading edge rather than full-bleed, which is
 * what makes a list of rows read as a group instead of as a stack of cards.
 *
 * A row that is one accessibility element - an expense, a category - composes its own
 * label and suppresses its children. That is not done here, because the composition is
 * per-screen (`04-expense-list.md` §Accessibility, `07-categories.md` §5); this component
 * takes whatever accessibility props it is handed and gets out of the way.
 */

/**
 * The chevron and the separator carry no accessible name — they are shape, and the row's
 * composed label says in words whatever they say in pixels. So a test that wants to ask
 * whether a row opens something, or whether it closes a group, has nothing to query them
 * by; these are how it asks. Same reasoning as `BANNER_ICON_TEST_ID`.
 */
export const ROW_CHEVRON_TEST_ID = 'row-chevron';
export const ROW_SEPARATOR_TEST_ID = 'row-separator';
/** Likewise the colour swatch, which is shape too: the category's name names it. */
export const SWATCH_TEST_ID = 'swatch';

export interface RowProps {
  /** Leading content: an icon, a swatch. Decorative by default. */
  readonly leading?: ReactNode;
  /** The row's own content, flexed. */
  readonly children: ReactNode;
  /** Trailing content, before the chevron. */
  readonly trailing?: ReactNode;
  /** Draw the `chevron-right` that means "this opens something" (§5). */
  readonly chevron?: boolean;
  readonly onPress?: () => void;
  /** A long press, which starts a selection where a list offers one. */
  readonly onLongPress?: () => void;
  /** Omit the bottom separator - for the last row of a group. */
  readonly lastInGroup?: boolean;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  /**
   * Selection and availability, as state rather than as a glyph.
   *
   * The category picker's check mark and the month grid's fill are both purely visual
   * cues, so the rows that carry them must also carry `selected`
   * (`00-foundations.md` §8 rule 4).
   */
  readonly accessibilityState?: { readonly selected?: boolean; readonly disabled?: boolean };
  readonly accessibilityActions?: readonly { readonly name: string; readonly label: string }[];
  readonly onAccessibilityAction?: (event: {
    readonly nativeEvent: { readonly actionName: string };
  }) => void;
  readonly testID?: string;
}

export function Row({
  leading,
  children,
  trailing,
  chevron = false,
  onPress,
  onLongPress,
  lastInGroup = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityActions,
  onAccessibilityAction,
  testID,
}: RowProps) {
  const color = useColors();
  const styles = useStyles();
  const interactive = onPress !== undefined;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!interactive}
      // One element, so a screen reader announces the composed label rather than each
      // child in turn (`00-foundations.md` §8 rule 6).
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      accessibilityActions={
        accessibilityActions === undefined ? undefined : [...accessibilityActions]
      }
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed && interactive ? color.bg.sunken : color.bg.surface },
      ]}
    >
      {leading === undefined ? null : <View style={styles.leading}>{leading}</View>}

      <View style={styles.content}>{children}</View>

      {trailing}

      {chevron ? (
        <Feather
          testID={ROW_CHEVRON_TEST_ID}
          name="chevron-right"
          size={20}
          color={color.text.tertiary}
          style={styles.chevron}
        />
      ) : null}

      {lastInGroup ? null : <View testID={ROW_SEPARATOR_TEST_ID} style={styles.separator} />}
    </Pressable>
  );
}

/** A row's primary line, and its optional second line. */
export function RowTitle({ children }: { readonly children: ReactNode }) {
  const styles = useStyles();
  return (
    <Text style={styles.title} numberOfLines={1}>
      {children}
    </Text>
  );
}

export function RowSubtitle({
  children,
  lines = 1,
}: {
  readonly children: ReactNode;
  /** One line by default; a screen with long hints (Settings) may allow more. */
  readonly lines?: number;
}) {
  const styles = useStyles();
  return (
    <Text style={styles.subtitle} numberOfLines={lines}>
      {children}
    </Text>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    row: {
      // A floor. Rows grow with content and with font scale (§2 note 1).
      minHeight: size.rowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space[4],
      paddingVertical: space[3],
      gap: space[3],
    },
    leading: {
      justifyContent: 'center',
    },
    content: {
      flex: 1,
      gap: 2,
    },
    chevron: {
      marginLeft: space[1],
    },
    separator: {
      position: 'absolute',
      bottom: 0,
      // Inset to the content's leading edge, not full-bleed (§6).
      left: space[4],
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: color.border.hairline,
    },
    title: {
      ...type.body,
      color: color.text.primary,
    },
    subtitle: {
      ...type.callout,
      color: color.text.secondary,
    },
  }),
);

/** A category's colour, as a 24x24 `radius.sm` square (`04-expense-list.md` element 10). */
export function Swatch({
  colorHex,
  diameter = size.swatch,
  name,
}: {
  readonly colorHex: string;
  readonly diameter?: number;
  /** When given, the category's icon is drawn in white on the colour. */
  readonly name?: string;
}) {
  const { isDark } = useTheme();
  return (
    <View
      testID={SWATCH_TEST_ID}
      // Decorative: the category's name is beside it and carries the identity, because
      // the ten category hues are separated by hue and not by lightness
      // (`00-foundations.md` §1.3).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: diameter,
        height: diameter,
        borderRadius: radius.sm,
        backgroundColor: displayCategoryColor(colorHex, isDark),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {name === undefined ? null : (
        <Feather
          testID="swatch-icon"
          name={categoryIcon(name)}
          size={Math.round(diameter * 0.58)}
          color="#FFFFFF"
        />
      )}
    </View>
  );
}
