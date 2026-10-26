import { useCallback, useState } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppBar, Fab, IconButton, PendingGlyph } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { Row, RowSubtitle, RowTitle, Swatch } from '@/components/Row';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { useSnackbar } from '@/components/Snackbar';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { useCategoriesWithCounts, useRecurringList, useUserCurrency } from '@/db/hooks';
import { useLocalWrite } from '@/db/localWrite';
import {
  type NewRecurring,
  createRecurring,
  deleteRecurring,
  updateRecurring,
} from '@/db/mutations';
import type { RecurringListItem } from '@/db/queries';
import { useSelectedMonth } from '@/month/MonthProvider';
import { generateDueRecurring } from '@/recurring/generate';
import { RecurringFormSheet } from '@/recurring/RecurringFormSheet';
import { recurringNextLabel, recurringSummary, recurringTitle } from '@/recurring/recurringModel';
import { color, size, space, type } from '@/theme/tokens';

/**
 * Recurring expenses: the rules the device turns into real expenses.
 *
 * Saving a rule runs the generator straight away, in the same local write, so a rule that
 * starts in the past shows its backfilled expenses on Home immediately rather than at the
 * next launch. Deleting one removes the rule only: what it already added is real spending
 * and stays (`deleteRecurring`).
 */

export const RECURRING_ROW_TEST_ID_PREFIX = 'recurring-row';
export const RECURRING_DELETE_DIALOG_TEST_ID = 'recurring-delete-dialog';

export default function RecurringScreen() {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const { today } = useSelectedMonth();

  const rules = useRecurringList();
  const categories = useCategoriesWithCounts();
  const currency = useUserCurrency().data ?? 'USD';

  const [editing, setEditing] = useState<RecurringListItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecurringListItem | null>(null);

  const rows = rules.data ?? [];
  const fallbackName = categories.data?.find((c) => c.isDefault)?.name ?? '';

  const submit = useCallback(
    async (value: Omit<NewRecurring, 'currency'>) => {
      await localWrite(async (db) => {
        if (editing === null) {
          await createRecurring(db, { ...value, currency });
        } else {
          await updateRecurring(db, editing.id, { ...value, currency });
        }
        await generateDueRecurring(db);
      });
      setSheetOpen(false);
      showSnackbar({ message: SNACK_COPY.recurring.saved });
    },
    [editing, currency, localWrite, showSnackbar],
  );

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    const target = pendingDelete;
    setPendingDelete(null);
    await localWrite((db) => deleteRecurring(db, target.id));
    showSnackbar({ message: SNACK_COPY.recurring.deleted });
    AccessibilityInfo.announceForAccessibility(SNACK_COPY.recurring.deleted);
  }, [pendingDelete, localWrite, showSnackbar]);

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.recurring.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="recurring-back"
          />
        }
      />

      <FlatList
        data={rows}
        keyExtractor={(rule) => rule.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <SwipeToDelete
            onDelete={() => setPendingDelete(item)}
            actionLabel={COPY.common.delete}
            testID={`recurring-swipe-${item.id}`}
          >
            <Row
              testID={`${RECURRING_ROW_TEST_ID_PREFIX}-${item.id}`}
              onPress={() => {
                setEditing(item);
                setSheetOpen(true);
              }}
              chevron
              lastInGroup={index === rows.length - 1}
              leading={<Swatch colorHex={item.categoryColor ?? color.text.tertiary} />}
              accessibilityLabel={`${recurringTitle(item, fallbackName)}, ${recurringSummary(item)}, ${recurringNextLabel(item, today)}`}
              accessibilityHint="Double tap to edit this recurring expense."
              accessibilityActions={[
                { name: 'delete', label: `Delete ${recurringTitle(item, fallbackName)}` },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'delete') setPendingDelete(item);
              }}
              trailing={item.pending ? <PendingGlyph /> : null}
            >
              <RowTitle>{recurringTitle(item, fallbackName)}</RowTitle>
              <RowSubtitle>{`${recurringSummary(item)} · ${recurringNextLabel(item, today)}`}</RowSubtitle>
            </Row>
          </SwipeToDelete>
        )}
        ListEmptyComponent={
          rules.isPending ? null : (
            <View style={styles.empty} testID="recurring-empty">
              <Text style={styles.emptyHeadline} accessibilityRole="header">
                {COPY.recurring.empty.headline}
              </Text>
              <Text style={styles.emptyBody}>{COPY.recurring.empty.body}</Text>
            </View>
          )
        }
      />

      <Fab
        label={COPY.recurring.fab}
        onPress={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
        testID="recurring-fab"
      />

      <RecurringFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
        categories={categories.data ?? []}
        currency={currency}
        today={today}
        onSubmit={submit}
        onDelete={
          editing === null
            ? undefined
            : () => {
                setSheetOpen(false);
                setPendingDelete(editing);
              }
        }
      />

      <Dialog
        visible={pendingDelete !== null}
        title={COPY.recurring.deleteDialog.title}
        body={COPY.recurring.deleteDialog.body}
        destructive={{ label: COPY.common.delete, onPress: () => void confirmDelete() }}
        onCancel={() => setPendingDelete(null)}
        testID={RECURRING_DELETE_DIALOG_TEST_ID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg.canvas },
  list: { paddingBottom: size.fab + space[4] + space[4] },
  empty: { padding: space[6], gap: space[2], alignItems: 'center' },
  emptyHeadline: { ...type.title1, color: color.text.primary, textAlign: 'center' },
  emptyBody: { ...type.body, color: color.text.secondary, textAlign: 'center' },
});
