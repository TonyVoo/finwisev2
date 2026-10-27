import { StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { type Insight, insightText } from './insightsModel';

export const INSIGHTS_TEST_ID = 'summary-insights';

export function InsightsCard({
  insights,
  previousLabel,
  currency,
}: {
  readonly insights: readonly Insight[];
  readonly previousLabel: string;
  readonly currency: string;
}) {
  const styles = useStyles();
  if (insights.length === 0) return null;
  return (
    <View testID={INSIGHTS_TEST_ID} style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">
        {COPY.summary.insights.title}
      </Text>
      {insights.map((insight) => (
        <Text key={insight.kind} style={styles.line}>
          {insightText(insight, COPY.summary.insights, previousLabel, currency)}
        </Text>
      ))}
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      backgroundColor: color.bg.surface,
      borderRadius: radius.lg,
      marginHorizontal: space[4],
      marginTop: space[4],
      padding: space[4],
      gap: space[2],
    },
    heading: { ...type.headline, color: color.text.primary },
    line: { ...type.body, color: color.text.secondary },
  }),
);
