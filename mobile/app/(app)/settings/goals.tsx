import { useDatabase } from '@/db/DatabaseProvider';
import { requestReminderPermission } from '@/notifications/billReminders';
import { syncGoalReminders } from '@/notifications/goalReminders';
import { EmptyIcon } from '@/components/EmptyIcon';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppBar, Fab, IconButton, PendingGlyph } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { useSnackbar } from '@/components/Snackbar';
import { COPY, SNACK_COPY } from '@/copy/strings';
import { useGoalsList, useUserCurrency } from '@/db/hooks';
import { useLocalWrite } from '@/db/localWrite';
import { type NewGoal, createGoal, deleteGoal, depositToGoal, updateGoal } from '@/db/mutations';
import type { GoalListItem } from '@/db/queries';
import { DepositSheet } from '@/goals/DepositSheet';
import { GoalFormSheet } from '@/goals/GoalFormSheet';
import { GoalBadge, GoalBar } from '@/goals/GoalVisuals';
import { savedHaptic } from '@/lib/haptics';
import { goalAmounts, goalProgress, goalStatus } from '@/goals/goalModel';
import { useSelectedMonth } from '@/month/MonthProvider';
import { size, space, type } from '@/theme/tokens';
import { createStyles, useColors } from '@/theme/ThemeProvider';

/**
 * Savings goals. Tapping a goal opens the deposit sheet - adding money is the thing you come
 * here to do - and editing, or deleting, is one step further in. Progress is manual: the
 * device writes the new total, and sync carries it like any other field.
 */

export const GOAL_ROW_TEST_ID_PREFIX = 'goal-row';
export const GOAL_PROGRESS_TEST_ID_PREFIX = 'goal-progress';
export const GOAL_DELETE_DIALOG_TEST_ID = 'goal-delete-dialog';

export default function GoalsScreen() {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const { today } = useSelectedMonth();

  const database = useDatabase();
  const goals = useGoalsList();
  const currency = useUserCurrency().data ?? 'USD';
  const [depositing, setDepositing] = useState<GoalListItem | null>(null);
  const [editing, setEditing] = useState<GoalListItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GoalListItem | null>(null);

  const rows = goals.data ?? [];

  const submit = useCallback(
    async (value: Omit<NewGoal, 'currency'>) => {
      await localWrite(async (db) => {
        if (editing === null) await createGoal(db, { ...value, currency });
        else await updateGoal(db, editing.id, value);
      });
      // A deadline is what a reminder is for, so that is when to ask; the sync pass never does.
      void (value.deadline === null ? Promise.resolve(true) : requestReminderPermission())
        .then(() => syncGoalReminders(database))
        .catch(() => undefined);
      setSheetOpen(false);
      showSnackbar({ message: SNACK_COPY.goal.saved });
    },
    [editing, currency, localWrite, showSnackbar, database],
  );

  const deposit = useCallback(
    async (amountMinor: number) => {
      if (depositing === null) return;
      const target = depositing;
      await localWrite((db) => depositToGoal(db, target.id, amountMinor));
      savedHaptic();
      // A deposit changes what is left to save, which is in the reminder text.
      void syncGoalReminders(database).catch(() => undefined);
      setDepositing(null);
      showSnackbar({ message: SNACK_COPY.goal.deposited });
      AccessibilityInfo.announceForAccessibility(SNACK_COPY.goal.deposited);
    },
    [depositing, localWrite, showSnackbar, database],
  );

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    const target = pendingDelete;
    setPendingDelete(null);
    await localWrite((db) => deleteGoal(db, target.id));
    void syncGoalReminders(database).catch(() => undefined);
    showSnackbar({ message: SNACK_COPY.goal.deleted });
    AccessibilityInfo.announceForAccessibility(SNACK_COPY.goal.deleted);
  }, [pendingDelete, localWrite, showSnackbar, database]);

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.goals.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="goals-back"
          />
        }
      />

      <FlatList
        data={rows}
        keyExtractor={(goal) => goal.id}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const progress = goalProgress(item.savedMinor, item.targetMinor);
          const status = goalStatus(item, today);
          return (
            <SwipeToDelete
              onDelete={() => setPendingDelete(item)}
              actionLabel={COPY.common.delete}
              testID={`goal-swipe-${item.id}`}
            >
              <Row
                testID={`${GOAL_ROW_TEST_ID_PREFIX}-${item.id}`}
                onPress={() => setDepositing(item)}
                chevron
                leading={<GoalBadge reached={progress.reached} />}
                lastInGroup={index === rows.length - 1}
                accessibilityLabel={`${item.name}, ${goalAmounts(item)}, ${progress.percent}%${status === null ? '' : `, ${status}`}`}
                accessibilityHint={COPY.a11y.addToGoal}
                accessibilityActions={[
                  { name: 'delete', label: COPY.a11y.deleteNamed.replace('{name}', item.name) },
                ]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'delete') setPendingDelete(item);
                }}
                trailing={item.pending ? <PendingGlyph /> : null}
              >
                <RowTitle>{item.name}</RowTitle>
                <RowSubtitle>{`${goalAmounts(item)} · ${progress.percent}%`}</RowSubtitle>
                <GoalBar
                  fill={progress.fill}
                  reached={progress.reached}
                  testID={`${GOAL_PROGRESS_TEST_ID_PREFIX}-${item.id}`}
                />
                {status === null ? null : <Text style={styles.status}>{status}</Text>}
              </Row>
            </SwipeToDelete>
          );
        }}
        ListEmptyComponent={
          goals.isPending ? null : (
            <View style={styles.empty} testID="goals-empty">
              <EmptyIcon name="target" />
              <Text style={styles.emptyHeadline} accessibilityRole="header">
                {COPY.goals.empty.headline}
              </Text>
              <Text style={styles.emptyBody}>{COPY.goals.empty.body}</Text>
            </View>
          )
        }
      />

      <Fab
        label={COPY.goals.fab}
        onPress={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
        testID="goals-fab"
      />

      <DepositSheet
        goal={depositing}
        onClose={() => setDepositing(null)}
        onDeposit={deposit}
        onEdit={() => {
          setEditing(depositing);
          setDepositing(null);
          setSheetOpen(true);
        }}
      />

      <GoalFormSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        editing={editing}
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
        title={COPY.goals.deleteDialog.title}
        body={COPY.goals.deleteDialog.body}
        destructive={{ label: COPY.common.delete, onPress: () => void confirmDelete() }}
        onCancel={() => setPendingDelete(null)}
        testID={GOAL_DELETE_DIALOG_TEST_ID}
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    list: { paddingBottom: size.fab + space[4] + space[4] },
    status: { ...type.callout, color: color.text.secondary, marginTop: space[1] },
    empty: { padding: space[6], gap: space[2], alignItems: 'center' },
    emptyHeadline: { ...type.title1, color: color.text.primary, textAlign: 'center' },
    emptyBody: { ...type.body, color: color.text.secondary, textAlign: 'center' },
  }),
);
