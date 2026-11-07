import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COPY } from '../copy/strings';
import { formatMoney } from '../lib/money';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import type { BudgetSuggestion } from './budgetSuggest';

export const SUGGEST_TEST_ID = 'summary-suggest';
export const SUGGEST_USE_PREFIX = 'summary-suggest-use';
export const SUGGEST_LIMIT_TEST_ID = 'summary-suggest-limit';
export const SUGGEST_ALL_TEST_ID = 'summary-suggest-all';
export const SUGGEST_LATER_TEST_ID = 'summary-suggest-later';

/** A budget suggestion per category, and one for the whole month. Using one is the person's tap; nothing is set until. */
export function BudgetSuggestionsCard({
  suggestions,
  limit,
  currency,
  onUse,
  onUseLimit,
  onUseAll,
  onLater,
}: {
  readonly suggestions: readonly BudgetSuggestion[];
  /** A limit for the whole month, with what the months averaged, or null for none to offer. */
  readonly limit: { readonly suggestedMinor: number; readonly averageMinor: number } | null;
  readonly currency: string;
  readonly onUse: (suggestion: BudgetSuggestion) => void;
  readonly onUseLimit: (minor: number) => void;
  readonly onUseAll: () => void;
  readonly onLater: () => void;
}) {
  const styles = useStyles();
  const color = useColors();
  if (suggestions.length === 0 && limit === null) return null;
  const money = (minor: number) => formatMoney(minor, currency);
  return (
    <View testID={SUGGEST_TEST_ID} style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">
        {COPY.summary.suggest.title}
      </Text>
      <Text style={styles.muted}>{COPY.summary.suggest.intro}</Text>

      {suggestions.map((s) => (
        <View key={s.categoryId} style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.title}>
              {COPY.summary.suggest.row
                .replace('{name}', s.name)
                .replace('{amount}', money(s.suggestedMinor))}
            </Text>
            <Text style={styles.muted}>
              {s.currentMinor === null
                ? COPY.summary.suggest.detailNew.replace('{average}', money(s.averageMinor))
                : COPY.summary.suggest.detailChange
                    .replace('{current}', money(s.currentMinor))
                    .replace('{average}', money(s.averageMinor))}
            </Text>
          </View>
          <Pressable
            testID={`${SUGGEST_USE_PREFIX}-${s.categoryId}`}
            onPress={() => onUse(s)}
            accessibilityRole="button"
            accessibilityLabel={`${COPY.summary.suggest.use}: ${s.name}`}
            style={({ pressed }) => [
              styles.use,
              pressed ? { backgroundColor: color.bg.sunken } : null,
            ]}
          >
            <Text style={styles.useText}>{COPY.summary.suggest.use}</Text>
          </Pressable>
        </View>
      ))}

      {limit === null ? null : (
        <View style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.title}>
              {COPY.summary.suggest.limitRow.replace('{amount}', money(limit.suggestedMinor))}
            </Text>
            <Text style={styles.muted}>
              {COPY.summary.suggest.limitDetail.replace('{average}', money(limit.averageMinor))}
            </Text>
          </View>
          <Pressable
            testID={SUGGEST_LIMIT_TEST_ID}
            onPress={() => onUseLimit(limit.suggestedMinor)}
            accessibilityRole="button"
            accessibilityLabel={`${COPY.summary.suggest.use}: ${COPY.summary.suggest.limitRow.replace('{amount}', money(limit.suggestedMinor))}`}
            style={({ pressed }) => [
              styles.use,
              pressed ? { backgroundColor: color.bg.sunken } : null,
            ]}
          >
            <Text style={styles.useText}>{COPY.summary.suggest.use}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.footer}>
        <Pressable testID={SUGGEST_LATER_TEST_ID} onPress={onLater} accessibilityRole="button">
          <Text style={styles.muted}>{COPY.summary.suggest.later}</Text>
        </Pressable>
        <Pressable testID={SUGGEST_ALL_TEST_ID} onPress={onUseAll} accessibilityRole="button">
          <Text style={styles.useText}>{COPY.summary.suggest.useAll}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      backgroundColor: color.bg.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
      marginHorizontal: space[4],
      marginTop: space[4],
      padding: space[4],
      gap: space[3],
    },
    heading: { ...type.headline, color: color.text.primary },
    row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
    text: { flex: 1, gap: 2 },
    title: { ...type.bodyStrong, color: color.text.primary },
    muted: { ...type.callout, color: color.text.secondary },
    use: {
      paddingVertical: space[2],
      paddingHorizontal: space[3],
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: color.border.hairline,
    },
    useText: { ...type.callout, color: color.primary.default, fontWeight: '600' },
    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  }),
);
