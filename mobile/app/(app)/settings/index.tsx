import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSessionController } from '@/auth/SessionProvider';
import { Button } from '@/components/Button';
import { AppBar, IconButton } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { useSnackbar } from '@/components/Snackbar';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { exportExpenses, nativeExportDependencies } from '@/export/exportExpenses';
import { usePendingRecordCount, useUserCurrency, useUserEmail } from '@/db/hooks';
import { color, space, type } from '@/theme/tokens';

/**
 * Settings: `docs/design/04-expense-list.md` §Behaviour rule 14.
 *
 * Three rows and a `Log out` button: the account email and currency (both read-only) and
 * `Categories`, which is the way into category management.
 *
 * Log out is wiring plus a dialog, not session logic - `session.signOut()` already does
 * the four steps rule 14 lists (revoke, clear secure store, wipe the local database, and
 * the auth gate in `(app)/_layout.tsx` replaces the stack by redirecting to Welcome once
 * the session is anonymous). It sat unreachable for two tasks because each assumed the
 * other had it (`TVO-35`, `GAP 24`).
 *
 * The dialog's body is the one thing that varies: unsynced changes are about to be
 * destroyed by the wipe, so when the outbox is non-empty it says so. The count is the
 * same `usePendingRecordCount` the sync pill reads, so the two cannot disagree.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const session = useSessionController();
  const currency = useUserCurrency();
  const email = useUserEmail();
  const pending = usePendingRecordCount();
  const database = useDatabase();
  const showSnackbar = useSnackbar();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasUnsynced = (pending.data ?? 0) > 0;

  /**
   * Export is a local read, a file write and the OS share sheet - no network - so it has
   * no offline state to design. `exporting` only stops a second tap while the first is
   * still writing; the result is the share sheet, or one snackbar saying why not.
   */
  async function onExport(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportExpenses({
        database,
        now: () => new Date(),
        ...nativeExportDependencies,
      });
      if (result.status === 'empty') showSnackbar({ message: COPY.export.empty });
      if (result.status === 'unavailable') showSnackbar({ message: COPY.export.unavailable });
    } catch {
      showSnackbar({ message: COPY.export.failed });
    } finally {
      setExporting(false);
    }
  }

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

      <Row
        testID="settings-email"
        accessibilityLabel={`${COPY.settings.email}, ${email.data ?? ''}`}
        trailing={<Text style={styles.value}>{email.data ?? ''}</Text>}
      >
        <RowTitle>{COPY.settings.email}</RowTitle>
      </Row>

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
        accessibilityLabel={COPY.settings.categories}
      >
        <RowTitle>{COPY.settings.categories}</RowTitle>
      </Row>

      <Row
        testID="settings-recurring"
        onPress={() => router.push('/(app)/settings/recurring')}
        chevron
        lastInGroup
        accessibilityLabel={`${COPY.settings.recurring}. ${COPY.settings.recurringHint}`}
      >
        <RowTitle>{COPY.settings.recurring}</RowTitle>
        <RowSubtitle>{COPY.settings.recurringHint}</RowSubtitle>
      </Row>

      <View style={styles.group}>
        <Row
          testID="settings-export"
          onPress={() => void onExport()}
          lastInGroup
          accessibilityLabel={`${COPY.settings.export}. ${COPY.settings.exportHint}`}
          accessibilityState={{ disabled: exporting }}
        >
          <RowTitle>{COPY.settings.export}</RowTitle>
          <RowSubtitle>{exporting ? COPY.export.busy : COPY.settings.exportHint}</RowSubtitle>
        </Row>
      </View>

      <View style={styles.group}>
        <Row
          testID="settings-change-password"
          onPress={() => router.push('/(app)/settings/change-password')}
          chevron
          accessibilityLabel={COPY.settings.changePassword}
        >
          <RowTitle>{COPY.settings.changePassword}</RowTitle>
        </Row>
        <Row
          testID="settings-delete-account"
          onPress={() => router.push('/(app)/settings/delete-account')}
          chevron
          lastInGroup
          accessibilityLabel={COPY.settings.deleteAccount}
        >
          <RowTitle>{COPY.settings.deleteAccount}</RowTitle>
        </Row>
      </View>

      <View style={styles.logout}>
        <Button
          label={COPY.settings.logout}
          variant="destructive"
          fullWidth
          onPress={() => setConfirmingLogout(true)}
          testID="settings-logout"
        />
      </View>

      <Dialog
        visible={confirmingLogout}
        testID="logout-dialog"
        title={COPY.logout.title}
        body={hasUnsynced ? COPY.logout.bodyPending : COPY.logout.bodyClean}
        destructive={{
          label: COPY.logout.confirm,
          onPress: () => {
            setConfirmingLogout(false);
            // The gate redirects to Welcome when the session goes anonymous; nothing to
            // navigate here. `signOut` does not reject for want of a network.
            void session.signOut();
          },
        }}
        onCancel={() => setConfirmingLogout(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg.canvas,
  },
  group: {
    marginTop: space[6],
  },
  logout: {
    paddingHorizontal: space[4],
    paddingTop: space[8],
  },
  value: {
    ...type.body,
    color: color.text.secondary,
  },
});
