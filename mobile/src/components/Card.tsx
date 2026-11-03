import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * A group of rows as one rounded card, with a small title above it - the shape Settings and the other list
 * screens share. Rows keep their own insets and separators; the card clips the last row's separator, so the
 * group ends cleanly at its rounded edge.
 */
export function Card({
  children,
  testID,
}: {
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

/**
 * One row of a list that is a card as a whole: the first row takes the top corners and the last the bottom ones,
 * so a FlatList or SectionList (which cannot wrap its items in one view) still reads as a rounded group.
 */
export function CardRow({
  index,
  count,
  children,
}: {
  readonly index: number;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View
      style={[
        styles.row,
        index === 0 ? styles.first : null,
        index === count - 1 ? styles.last : null,
      ]}
    >
      {children}
    </View>
  );
}

/** The small caps-less heading above a {@link Card}. */
export function SectionTitle({ children }: { readonly children: ReactNode }) {
  const styles = useStyles();
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      marginHorizontal: space[4],
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    row: {
      marginHorizontal: space[4],
      overflow: 'hidden',
      backgroundColor: color.bg.surface,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    first: {
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    last: {
      borderBottomLeftRadius: radius.lg,
      borderBottomRightRadius: radius.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    // The last row's separator sits on the card's edge and is clipped away.
    inner: { marginBottom: -StyleSheet.hairlineWidth },
    title: {
      ...type.subhead,
      color: color.text.secondary,
      marginHorizontal: space[5],
      marginTop: space[5],
      marginBottom: space[2],
    },
  }),
);
