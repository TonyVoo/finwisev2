import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppBar, IconButton } from '@/components/Chrome';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { COPY } from '@/copy/strings';
import { useUserCurrency } from '@/db/hooks';
import { color, type } from '@/theme/tokens';

/**
 * Settings: `docs/design/04-expense-list.md` §Behaviour rule 14.
 *
 * Rule 14 describes three rows and a `Log out` button. **Only the Categories row is built
 * here**, because that is the one `TVO-11` needs: Categories is reached from this screen,
 * so without it the category management screen has no route into it.
 *
 * Log out is deliberately left out rather than half-built. Rule 14 makes it a four-step
 * operation - revoke the refresh token, clear secure store, **wipe the local database**,
 * replace the stack - gated by a dialog whose body depends on whether the outbox is
 * empty. A version that skipped the wipe would leave one user's expenses in another
 * user's database, which is worse than a button that is not there yet. Raised on
 * `TVO-11`; it belongs with the session work.
 *
 * The email row is omitted for the same reason: the user's email is on the session's user
 * row, and reading it here is the same small piece of work as Log out needs.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const currency = useUserCurrency();

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.settings.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="settings-back"
          />
        }
      />

      {/* Read-only, with the reason stated: the currency is fixed at signup
          (`03-auth.md` §Behaviour rule 9), so this says so rather than looking tappable. */}
      <Row
        accessibilityLabel={`${COPY.settings.currency}, ${currency.data ?? ''}. ${
          COPY.settings.currencyHint
        }`}
        trailing={<Text style={styles.value}>{currency.data ?? ''}</Text>}
      >
        <RowTitle>{COPY.settings.currency}</RowTitle>
        <RowSubtitle>{COPY.settings.currencyHint}</RowSubtitle>
      </Row>

      <Row
        testID="settings-categories"
        onPress={() => router.push('/(app)/settings/categories')}
        chevron
        lastInGroup
        accessibilityLabel={COPY.settings.categories}
      >
        <RowTitle>{COPY.settings.categories}</RowTitle>
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg.canvas,
  },
  value: {
    ...type.body,
    color: color.text.secondary,
  },
});
