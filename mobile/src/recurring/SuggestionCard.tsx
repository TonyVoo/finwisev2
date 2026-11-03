import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { formatMoney } from '../lib/money';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import type { RecurringSuggestion } from './detectRecurring';

export const SUGGESTION_TEST_ID_PREFIX = 'recurring-suggestion';

/** One suggested rule: what it is, how it was noticed, and Add / Not now. */
export function SuggestionCard({
  suggestion,
  categoryName,
  index,
  onAdd,
  onDismiss,
}: {
  readonly suggestion: RecurringSuggestion;
  readonly categoryName: string;
  readonly index: number;
  readonly onAdd: () => void;
  readonly onDismiss: () => void;
}) {
  const styles = useStyles();
  const copy = COPY.recurringSuggestions;
  const title = suggestion.note ?? categoryName;
  const line = copy.line
    .replace('{amount}', formatMoney(suggestion.amountMinor, suggestion.currency))
    .replace('{day}', String(Number(suggestion.nextDate.slice(8, 10))));
  return (
    <View style={styles.card} testID={`${SUGGESTION_TEST_ID_PREFIX}-${index}`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.line}>{line}</Text>
      <Text style={styles.seen}>
        {copy.seen.replace('{count}', String(suggestion.occurrences))}
      </Text>
      <View style={styles.actions}>
        <Button
          label={copy.add}
          onPress={onAdd}
          testID={`${SUGGESTION_TEST_ID_PREFIX}-add-${index}`}
        />
        <Button
          label={copy.dismiss}
          variant="ghost"
          onPress={onDismiss}
          testID={`${SUGGESTION_TEST_ID_PREFIX}-dismiss-${index}`}
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      marginHorizontal: space[4],
      padding: space[4],
      gap: space[1],
      borderRadius: radius.lg,
      backgroundColor: color.primary.subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    title: { ...type.headline, color: color.text.primary },
    line: { ...type.body, color: color.text.secondary },
    seen: { ...type.footnote, color: color.text.tertiary },
    actions: { flexDirection: 'row', gap: space[2], alignItems: 'center', marginTop: space[2] },
  }),
);
