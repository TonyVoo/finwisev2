import { StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

/**
 * The screening score as five segments, filled up to the score: a meter, not a number you have to interpret.
 * Weak is red, middling is amber, strong is green - and the segments are the shape of it, so the meter reads
 * without the colour too.
 */

export const SCORE_SEGMENTS = 5;

/** How many of the five segments the score fills: 0 for none, 5 for 80 and over. */
export function filledSegments(score: number | null): number {
  if (score === null) return 0;
  return Math.min(SCORE_SEGMENTS, Math.max(0, Math.ceil(score / (100 / SCORE_SEGMENTS))));
}

export type ScoreTone = 'weak' | 'middling' | 'strong' | 'none';

export function scoreTone(score: number | null): ScoreTone {
  if (score === null) return 'none';
  return score >= 60 ? 'strong' : score >= 40 ? 'middling' : 'weak';
}

export function ScoreMeter({
  score,
  testID,
}: {
  readonly score: number | null;
  readonly testID?: string;
}) {
  const styles = useStyles();
  const color = useColors();
  const tone = scoreTone(score);
  const active =
    tone === 'strong'
      ? color.success.default
      : tone === 'middling'
        ? color.warning.default
        : color.danger.default;
  const filled = filledSegments(score);
  return (
    <View
      testID={testID}
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: SCORE_SEGMENTS }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, { backgroundColor: index < filled ? active : color.bg.sunken }]}
        />
      ))}
    </View>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: space[1] },
    segment: { flex: 1, height: 8, borderRadius: radius.pill },
  }),
);
