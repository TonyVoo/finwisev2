import { useCallback } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppBar, IconButton, PendingGlyph } from '../components/Chrome';
import { EmptyIcon } from '../components/EmptyIcon';
import { Row, RowSubtitle, RowTitle } from '../components/Row';
import { useSnackbar } from '../components/Snackbar';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { COPY } from '../copy/strings';
import { useSettlements, useUserCurrency, useUserEmail } from '../db/hooks';
import { useLocalWrite } from '../db/localWrite';
import { deleteSettlement, restoreSettlement } from '../db/mutations';
import type { SettlementListItem } from '../db/queries';
import { dayLabel } from '../lib/calendar';
import { warnHaptic } from '../lib/haptics';
import { formatMoney } from '../lib/money';
import { useSelectedMonth } from '../month/MonthProvider';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { labelOfMember } from './addedBy';
import { useHouseholdMembers } from './useHouseholdMembers';

/**
 * Every recorded payment, newest first (`docs/design/12-settle-up.md`), worded for the person
 * looking. Read from this phone's own rows, so it works offline.
 *
 * Only the two people a payment names can delete it - which is also all the server allows - so
 * everyone else's rows are read-only here instead of offering what would be refused. Deleting is
 * how a payment is undone, with an Undo, since the delete is just another local edit.
 */
export default function SettlementHistoryScreen() {
  const styles = useStyles();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const { today } = useSelectedMonth();
  const settlements = useSettlements();
  const members = useHouseholdMembers();
  const myEmail = useUserEmail().data;
  const currency = useUserCurrency().data ?? null;

  const meId = members.find((member) => member.email === myEmail)?.userId ?? null;
  const rows = settlements.data ?? [];

  const remove = useCallback(
    async (id: string) => {
      await localWrite((db) => deleteSettlement(db, id));
      warnHaptic();
      AccessibilityInfo.announceForAccessibility(COPY.household.history.deleted);
      showSnackbar({
        message: COPY.household.history.deleted,
        action: {
          label: COPY.common.undo,
          onPress: () => void localWrite((db) => restoreSettlement(db, id)),
        },
      });
    },
    [localWrite, showSnackbar],
  );

  const wording = (item: SettlementListItem): string => {
    const label = (userId: string) => labelOfMember(members, meId, userId);
    if (item.fromUserId === meId) {
      return COPY.household.history.youPaid.replace('{name}', label(item.toUserId));
    }
    if (item.toUserId === meId) {
      return COPY.household.history.paidYou.replace('{name}', label(item.fromUserId));
    }
    return COPY.household.history.paid
      .replace('{from}', label(item.fromUserId))
      .replace('{to}', label(item.toUserId));
  };

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.household.history.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            testID="history-back"
          />
        }
      />
      <FlatList
        testID="history-list"
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          const mine = item.fromUserId === meId || item.toUserId === meId;
          const amount = currency === null ? '' : formatMoney(item.amountMinor, currency);
          const note = item.note === null || item.note.trim() === '' ? null : item.note;
          const subtitle = [dayLabel(item.date, today), note]
            .filter((part): part is string => part !== null)
            .join(' · ');
          return (
            <SwipeToDelete
              enabled={mine}
              onDelete={() => void remove(item.id)}
              actionLabel={COPY.common.delete}
              testID={`settlement-swipe-${item.id}`}
            >
              <Row
                testID={`settlement-row-${item.id}`}
                lastInGroup={index === rows.length - 1}
                accessibilityLabel={`${wording(item)}, ${amount}, ${subtitle}`}
                accessibilityActions={
                  mine ? [{ name: 'delete', label: COPY.household.history.deleteAction }] : []
                }
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'delete') void remove(item.id);
                }}
                trailing={
                  <View style={styles.trailing}>
                    {item.pending ? <PendingGlyph /> : null}
                    <Text style={styles.amount}>{amount}</Text>
                  </View>
                }
              >
                <RowTitle>{wording(item)}</RowTitle>
                <RowSubtitle>{subtitle}</RowSubtitle>
              </Row>
            </SwipeToDelete>
          );
        }}
        ListEmptyComponent={
          settlements.isPending ? null : (
            <View style={styles.empty} testID="history-empty">
              <EmptyIcon name="repeat" />
              <Text style={styles.emptyHeadline} accessibilityRole="header">
                {COPY.household.history.emptyHeadline}
              </Text>
              <Text style={styles.emptyBody}>{COPY.household.history.emptyBody}</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    trailing: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
    amount: { ...type.bodyStrong, color: color.text.primary, fontVariant: ['tabular-nums'] },
    empty: { alignItems: 'center', gap: space[2], padding: space[8] },
    emptyHeadline: { ...type.title2, color: color.text.primary, textAlign: 'center' },
    emptyBody: { ...type.body, color: color.text.secondary, textAlign: 'center' },
  }),
);
