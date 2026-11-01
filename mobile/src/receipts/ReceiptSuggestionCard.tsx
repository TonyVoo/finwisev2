import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { radius, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';

export const RECEIPT_SUGGESTION_TEST_ID = 'receipt-suggestion';
export const RECEIPT_SUGGESTION_USE_TEST_ID = 'receipt-suggestion-use';
export const RECEIPT_SUGGESTION_DISMISS_TEST_ID = 'receipt-suggestion-dismiss';

/**
 * What a receipt reading found, offered for the person to take or leave
 * (`docs/design/11-receipt-scan.md`). It changes nothing by itself: Use hands the values to the
 * form, which puts them in the fields exactly as if they had been typed.
 */
export function ReceiptSuggestionCard({
  summary,
  onUse,
  onDismiss,
  title = COPY.form.receipt.scan.suggestionTitle,
  testIDPrefix = RECEIPT_SUGGESTION_TEST_ID,
}: {
  readonly summary: string;
  readonly onUse: () => void;
  readonly onDismiss: () => void;
  /** What the suggestion came from. A receipt reading by default; quick add passes its own. */
  readonly title?: string;
  /** `<prefix>`, `<prefix>-use` and `<prefix>-dismiss` are the card and its two buttons. */
  readonly testIDPrefix?: string;
}) {
  const styles = useStyles();
  const color = useColors();
  return (
    <View
      testID={testIDPrefix}
      style={styles.card}
      accessible
      accessibilityLabel={`${title}, ${summary}`}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.heading}>
        <Feather name="file-text" size={16} color={color.text.secondary} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.summary}>{summary}</Text>
      <View style={styles.actions}>
        <Button label={COPY.form.receipt.scan.use} onPress={onUse} testID={`${testIDPrefix}-use`} />
        <Button
          label={COPY.form.receipt.scan.dismiss}
          onPress={onDismiss}
          variant="ghost"
          testID={`${testIDPrefix}-dismiss`}
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      marginHorizontal: space[4],
      marginTop: space[2],
      padding: space[3],
      gap: space[2],
      borderRadius: radius.md,
      backgroundColor: color.bg.surface,
      borderWidth: 1,
      borderColor: color.border.input,
    },
    heading: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    title: { ...type.footnote, color: color.text.secondary },
    summary: { ...type.bodyStrong, color: color.text.primary },
    actions: { flexDirection: 'row', gap: space[2] },
  }),
);
