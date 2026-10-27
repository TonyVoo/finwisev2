import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSessionController } from '@/auth/SessionProvider';
import { Button } from '@/components/Button';
import { AppBar, IconButton } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { useSnackbar } from '@/components/Snackbar';
import { IconBadge } from '@/components/IconBadge';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { planDefaultRenames } from '@/categories/renameDefaults';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { useDatabase } from '@/db/DatabaseProvider';
import { markCategoryRenameAnswered } from '@/db/onboarding';
import { renameCategories } from '@/db/mutations';
import { useLocalWrite } from '@/db/localWrite';
import { exportExpenses, nativeExportDependencies } from '@/export/exportExpenses';
import {
  useCategoryRenameAnswered,
  useEmailVerified,
  useLiveCategories,
  usePendingRecordCount,
  useUserCurrency,
  useUserEmail,
} from '@/db/hooks';
import { LanguageSheet, languagePreferenceLabel } from '@/i18n/LanguageSheet';
import { useLanguage } from '@/i18n/LanguageProvider';
import { useAppLock } from '@/lock/AppLockProvider';
import { space, type } from '@/theme/tokens';
import { ThemeSheet, themePreferenceLabel } from '@/theme/ThemeSheet';
import { createStyles, useColors, useTheme } from '@/theme/ThemeProvider';

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
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const session = useSessionController();
  const currency = useUserCurrency();
  const email = useUserEmail();
  const emailVerified = useEmailVerified();
  const pending = usePendingRecordCount();
  const database = useDatabase();
  const showSnackbar = useSnackbar();
  const appLock = useAppLock();
  const toggleLock = async () => {
    const result = await appLock.setEnabled(!appLock.enabled);
    if (result.status === 'unavailable') showSnackbar({ message: COPY.lock.unavailable });
    else if (result.status === 'failed') {
      showSnackbar({
        message: __DEV__ ? `${COPY.lock.notConfirmed} (${result.code})` : COPY.lock.notConfirmed,
      });
    }
  };
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [choosingTheme, setChoosingTheme] = useState(false);
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const language = useLanguage();
  const { preference } = useTheme();
  const [offeringRename, setOfferingRename] = useState(false);
  const categories = useLiveCategories();
  const renameAnswered = useCategoryRenameAnswered();
  const localWrite = useLocalWrite();
  const renames =
    language.language === 'vi' && renameAnswered.data === false
      ? planDefaultRenames(categories.data ?? [], 'vi')
      : [];

  /** Read the categories afresh first, so the count in the dialog is what a yes will do. */
  async function offerRename(): Promise<void> {
    await categories.refetch();
    setOfferingRename(true);
  }

  async function answerRename(rename: boolean): Promise<void> {
    setOfferingRename(false);
    await localWrite(async (db) => {
      if (rename) await renameCategories(db, renames);
      await markCategoryRenameAnswered(db);
    });
    if (rename) showSnackbar({ message: SNACK_COPY.category.defaultsRenamed });
  }

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

      {/* Eight rows and a button no longer fit a short phone or a large font size; without
          this the Log out button below the fold simply could not be reached. */}
      <ScrollView contentContainerStyle={styles.content}>
        <Row
          testID="settings-email"
          leading={<IconBadge name="mail" />}
          onPress={() => router.push('/(app)/settings/change-email')}
          chevron
          accessibilityLabel={`${COPY.settings.email}, ${email.data ?? ''}`}
          trailing={<Text style={styles.value}>{email.data ?? ''}</Text>}
        >
          <RowTitle>{COPY.settings.email}</RowTitle>
        </Row>

        {/* Only while unverified, and only once the local row has answered: `false` is not
            `undefined`, and a row that flashes in then out on every open would be noise. */}
        {emailVerified.data === false ? (
          <Row
            testID="settings-verify-email"
            leading={<IconBadge name="check-circle" />}
            onPress={() => router.push('/(app)/settings/verify-email')}
            chevron
            accessibilityLabel={`${COPY.settings.verifyEmail}, ${COPY.settings.unverified}`}
            trailing={<Text style={styles.value}>{COPY.settings.unverified}</Text>}
          >
            <RowTitle>{COPY.settings.verifyEmail}</RowTitle>
          </Row>
        ) : null}

        {/* Read-only, with the reason stated: the currency is fixed at signup
          (`03-auth.md` §Behaviour rule 9), so this says so rather than looking tappable. */}
        <Row
          leading={<IconBadge name="dollar-sign" />}
          accessibilityLabel={`${COPY.settings.currency}, ${currency.data ?? ''}. ${
            COPY.settings.currencyHint
          }`}
          trailing={<Text style={styles.value}>{currency.data ?? ''}</Text>}
        >
          <RowTitle>{COPY.settings.currency}</RowTitle>
          <RowSubtitle lines={2}>{COPY.settings.currencyHint}</RowSubtitle>
        </Row>

        <Row
          testID="settings-categories"
          leading={<IconBadge name="tag" />}
          onPress={() => router.push('/(app)/settings/categories')}
          chevron
          accessibilityLabel={COPY.settings.categories}
        >
          <RowTitle>{COPY.settings.categories}</RowTitle>
        </Row>

        <Row
          testID="settings-recurring"
          leading={<IconBadge name="repeat" />}
          onPress={() => router.push('/(app)/settings/recurring')}
          chevron
          accessibilityLabel={`${COPY.settings.recurring}. ${COPY.settings.recurringHint}`}
        >
          <RowTitle>{COPY.settings.recurring}</RowTitle>
          <RowSubtitle lines={2}>{COPY.settings.recurringHint}</RowSubtitle>
        </Row>

        <Row
          testID="settings-goals"
          leading={<IconBadge name="target" />}
          onPress={() => router.push('/(app)/settings/goals')}
          chevron
          lastInGroup
          accessibilityLabel={`${COPY.settings.goals}. ${COPY.settings.goalsHint}`}
        >
          <RowTitle>{COPY.settings.goals}</RowTitle>
          <RowSubtitle lines={2}>{COPY.settings.goalsHint}</RowSubtitle>
        </Row>

        <View style={styles.group}>
          <Row
            testID="settings-appearance"
            leading={<IconBadge name="moon" />}
            onPress={() => setChoosingTheme(true)}
            chevron
            accessibilityLabel={`${COPY.settings.appearance}, ${themePreferenceLabel(preference)}`}
            trailing={<Text style={styles.value}>{themePreferenceLabel(preference)}</Text>}
          >
            <RowTitle>{COPY.settings.appearance}</RowTitle>
          </Row>
          <Row
            testID="settings-language"
            leading={<IconBadge name="globe" />}
            onPress={() => setChoosingLanguage(true)}
            chevron
            accessibilityLabel={`${COPY.language.title}, ${languagePreferenceLabel(language.preference)}`}
            trailing={
              <Text style={styles.value}>{languagePreferenceLabel(language.preference)}</Text>
            }
          >
            <RowTitle>{COPY.language.title}</RowTitle>
          </Row>
          {renames.length > 0 ? (
            <Row
              testID="settings-rename-categories"
              leading={<IconBadge name="edit-3" />}
              onPress={() => void offerRename()}
              accessibilityLabel={`${COPY.settings.renameCategories}. ${COPY.settings.renameCategoriesHint}`}
            >
              <RowTitle>{COPY.settings.renameCategories}</RowTitle>
              <RowSubtitle lines={2}>{COPY.settings.renameCategoriesHint}</RowSubtitle>
            </Row>
          ) : null}
          <Row
            testID="settings-app-lock"
            leading={<IconBadge name="lock" />}
            onPress={() => void toggleLock()}
            accessibilityLabel={`${COPY.lock.settingsRow}. ${COPY.lock.settingsHint}`}
            accessibilityState={{ selected: appLock.enabled }}
            trailing={
              <Switch
                value={appLock.enabled}
                onValueChange={() => void toggleLock()}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            }
          >
            <RowTitle>{COPY.lock.settingsRow}</RowTitle>
            <RowSubtitle lines={2}>{COPY.lock.settingsHint}</RowSubtitle>
          </Row>
          <Row
            testID="settings-export"
            leading={<IconBadge name="download" />}
            onPress={() => void onExport()}
            lastInGroup
            accessibilityLabel={`${COPY.settings.export}. ${COPY.settings.exportHint}`}
            accessibilityState={{ disabled: exporting }}
          >
            <RowTitle>{COPY.settings.export}</RowTitle>
            <RowSubtitle lines={2}>
              {exporting ? COPY.export.busy : COPY.settings.exportHint}
            </RowSubtitle>
          </Row>
        </View>

        <View style={styles.group}>
          <Row
            testID="settings-change-password"
            leading={<IconBadge name="key" />}
            onPress={() => router.push('/(app)/settings/change-password')}
            chevron
            accessibilityLabel={COPY.settings.changePassword}
          >
            <RowTitle>{COPY.settings.changePassword}</RowTitle>
          </Row>
          <Row
            testID="settings-delete-account"
            leading={<IconBadge name="trash-2" tone="danger" />}
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
      </ScrollView>

      <ThemeSheet visible={choosingTheme} onClose={() => setChoosingTheme(false)} />
      <LanguageSheet visible={choosingLanguage} onClose={() => setChoosingLanguage(false)} />

      <Dialog
        visible={offeringRename}
        testID="category-rename"
        cancelTestID="category-rename-dismiss"
        confirmVariant="primary"
        title={COPY.categoryRename.title.replace('{count}', String(renames.length))}
        body={COPY.categoryRename.body}
        destructive={{ label: COPY.categoryRename.confirm, onPress: () => void answerRename(true) }}
        cancelLabel={COPY.categoryRename.dismiss}
        onCancel={() => void answerRename(false)}
      />

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

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: color.bg.canvas,
    },
    content: {
      paddingBottom: space[8],
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
  }),
);
