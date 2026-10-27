import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { type BudgetAlert, alertBody, alertTitle } from '../summary/budgetAlerts';
import { radius, space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

/**
 * Home's heads-up that a category is over, or close to, its monthly budget.
 *
 * A card in the list's own column, like the category review prompt, and for the same
 * reason: it says something true that the person can ignore, and a dialog would put a
 * decision between them and the list they came for. It is not stored anywhere - it is
 * recomputed from the month's spend, so it goes away on its own once the spending does -
 * and Dismiss only hides it until the app restarts or the situation changes.
 */
export function BudgetAlertBanner({
  alert,
  onOpen,
  onDismiss,
}: {
  readonly alert: BudgetAlert;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
}) {
  const styles = useStyles();
  const over = alert.level === 'over';
  return (
    <View
      style={[styles.card, over ? styles.over : styles.near]}
      testID="budget-alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.title} accessibilityRole="header">
        {alertTitle(alert)}
      </Text>
      <Text style={styles.body}>{alertBody(alert)}</Text>
      <View style={styles.actions}>
        <Button label={COPY.home.budgetAlert.open} onPress={onOpen} testID="budget-alert-open" />
        <Button
          label={COPY.home.budgetAlert.dismiss}
          variant="ghost"
          onPress={onDismiss}
          testID="budget-alert-dismiss"
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    card: {
      marginHorizontal: space[4],
      marginBottom: space[3],
      padding: space[4],
      gap: space[2],
      borderRadius: radius.lg,
      borderWidth: 1,
    },
    // Not colour alone: the title states the level in words.
    over: { backgroundColor: color.danger.subtle, borderColor: color.danger.default },
    near: { backgroundColor: color.warning.subtle, borderColor: color.warning.default },
    title: { ...type.headline, color: color.text.primary },
    body: { ...type.body, color: color.text.secondary },
    actions: { flexDirection: 'row', gap: space[2], alignItems: 'center', marginTop: space[1] },
  }),
);
