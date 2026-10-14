import { StyleSheet, Text, View } from 'react-native';
import { PendingGlyph } from '../components/Chrome';
import { Row, RowSubtitle, RowTitle, Swatch } from '../components/Row';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { COPY } from '../copy/strings';
import type { CalendarDate } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import { color, space, type } from '../theme/tokens';
import type { ExpenseListItem } from '../db/queries';
import { expenseRowLabel, rowCategoryColor, rowCategoryName } from './listModel';

/**
 * One expense in the list: `docs/design/04-expense-list.md` elements 9-14 and 16.
 *
 * **The row is one accessibility element** (§Accessibility rule 1). Its children are
 * suppressed and it carries a single composed label, so a screen-reader user swipes once
 * per expense instead of four times - past a swatch, a name, a note and an amount that
 * only mean something together.
 *
 * Delete is reachable three ways, and the redundancy is required rather than generous:
 *
 * 1. the swipe gesture, which is invisible to a screen reader,
 * 2. an `accessibilityAction` named `delete`, which is what VoiceOver's Actions rotor and
 *    TalkBack's local context menu read, and
 * 3. the `Delete expense` button inside the edit form.
 *
 * Rule 3 of §Accessibility makes the point: the gesture "must not be the only path to
 * delete". Dropping either of the other two leaves assistive technology unable to perform
 * an operation the design offers everyone else.
 */

export const EXPENSE_AMOUNT_TEST_ID_PREFIX = 'expense-amount';

export interface ExpenseRowProps {
  readonly item: ExpenseListItem;
  readonly today: CalendarDate;
  readonly onPress: () => void;
  readonly onDelete: () => void;
  readonly lastInGroup?: boolean;
}

export function ExpenseRow({ item, today, onPress, onDelete, lastInGroup }: ExpenseRowProps) {
  return (
    <SwipeToDelete
      onDelete={onDelete}
      actionLabel={COPY.common.delete}
      testID={`expense-swipe-${item.id}`}
    >
      <Row
        testID={`expense-row-${item.id}`}
        onPress={onPress}
        lastInGroup={lastInGroup}
        leading={<Swatch colorHex={rowCategoryColor(item)} />}
        accessibilityLabel={expenseRowLabel(item, today)}
        accessibilityHint="Double tap to edit this expense."
        // The gesture's screen-reader equivalent. Named `delete` because that is the
        // standard action name both platforms surface in their own UI.
        accessibilityActions={[{ name: 'delete', label: 'Delete expense' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
        trailing={
          <View style={styles.trailing}>
            {item.pending ? <PendingGlyph /> : null}
            <Text
              testID={`${EXPENSE_AMOUNT_TEST_ID_PREFIX}-${item.id}`}
              style={styles.amount}
              // The amount must never truncate or ellipsise: "a clipped amount is worse
              // than a taller row" (§Accessibility rule 4).
              numberOfLines={1}
            >
              {formatMoney(item.amountMinor, item.currency)}
            </Text>
          </View>
        }
      >
        <RowTitle>{rowCategoryName(item)}</RowTitle>
        {/* Omitted entirely when there is no note, rather than rendered as an empty line -
            `''` and `null` would otherwise look different (`mutations.ts`, `normaliseNote`). */}
        {item.note === null || item.note.trim().length === 0 ? null : (
          <RowSubtitle>{item.note}</RowSubtitle>
        )}
      </Row>
    </SwipeToDelete>
  );
}

const styles = StyleSheet.create({
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  amount: {
    ...type.bodyStrong,
    color: color.text.primary,
    fontVariant: ['tabular-nums'],
  },
});
