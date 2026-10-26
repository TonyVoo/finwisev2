import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { COPY } from '../copy/strings';
import { color, radius, space, type } from '../theme/tokens';

/**
 * The one-time prompt on Home after signup, offering a way into the category editor.
 *
 * A card in the list's own column rather than a modal: it asks something the user can
 * safely ignore, and a dialog would put a decision between a brand-new user and the empty
 * state they came to see. Both buttons dismiss it for good (`db/onboarding.ts`).
 */
export function CategoryReviewBanner({
  onReview,
  onDismiss,
}: {
  readonly onReview: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <View style={styles.card} testID="category-review">
      <Text style={styles.title} accessibilityRole="header">
        {COPY.home.categoryReview.title}
      </Text>
      <Text style={styles.body}>{COPY.home.categoryReview.body}</Text>
      <View style={styles.actions}>
        <Button
          label={COPY.home.categoryReview.review}
          onPress={onReview}
          testID="category-review-open"
        />
        <Button
          label={COPY.home.categoryReview.dismiss}
          variant="ghost"
          onPress={onDismiss}
          testID="category-review-dismiss"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space[4],
    marginBottom: space[3],
    padding: space[4],
    gap: space[2],
    borderRadius: radius.lg,
    backgroundColor: color.bg.surface,
    borderWidth: 1,
    borderColor: color.border.input,
  },
  title: { ...type.headline, color: color.text.primary },
  body: { ...type.body, color: color.text.secondary },
  actions: { flexDirection: 'row', gap: space[2], alignItems: 'center', marginTop: space[1] },
});
