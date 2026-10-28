import { StyleSheet, Text, View } from 'react-native';
import { NeedsAttentionGlyph, PendingGlyph } from '../components/Chrome';
import { Row, RowSubtitle, RowTitle, Swatch } from '../components/Row';
import { SwipeToDelete } from '../components/SwipeToDelete';
import { COPY, SYNC_COPY } from '../copy/strings';
import type { CalendarDate } from '../lib/calendar';
import { formatMoney } from '../lib/money';
import { space, type } from '../theme/tokens';
import Feather from '@expo/vector-icons/Feather';
import { createStyles, useColors } from '../theme/ThemeProvider';
import type { ExpenseListItem } from '../db/queries';
import { expenseRowLabel, originalLabel, rowCategoryColor, rowCategoryName } from './listModel';

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
  /** "Added by Bao": who put it in a shared household's books. Absent when not shared. */
  readonly addedBy?: string | null;
  /** A long press, which starts picking several expenses. */
  readonly onLongPress?: () => void;
  /** Present while picking: whether this row is chosen, and whether it can be (only your own). */
  readonly selection?: { readonly selected: boolean; readonly selectable: boolean };
}

export function ExpenseRow({
  item,
  today,
  onPress,
  onDelete,
  lastInGroup,
  addedBy,
  onLongPress,
  selection,
}: ExpenseRowProps) {
  const styles = useStyles();
  const color = useColors();
  // What was actually paid, when that was in another currency, then the note.
  const original = originalLabel(item);
  const note = item.note === null || item.note.trim().length === 0 ? null : item.note;
  const subtitle =
    [original, note, addedBy ?? null].filter((part): part is string => part !== null).join(' · ') ||
    null;
  return (
    <SwipeToDelete
      onDelete={onDelete}
      actionLabel={COPY.common.delete}
      testID={`expense-swipe-${item.id}`}
    >
      <Row
        testID={`expense-row-${item.id}`}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityState={
          selection === undefined
            ? undefined
            : { selected: selection.selected, disabled: !selection.selectable }
        }
        lastInGroup={lastInGroup}
        leading={<Swatch colorHex={rowCategoryColor(item)} name={item.categoryName ?? undefined} />}
        accessibilityLabel={expenseRowLabel(item, today, undefined, addedBy)}
        accessibilityHint={COPY.a11y.editExpense}
        // The gesture's screen-reader equivalent. Named `delete` because that is the
        // standard action name both platforms surface in their own UI.
        accessibilityActions={[{ name: 'delete', label: COPY.a11y.deleteExpense }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
        trailing={
          <View style={styles.trailing}>
            {selection?.selectable === true ? (
              <Feather
                testID={`expense-select-${item.id}`}
                name={selection.selected ? 'check-circle' : 'circle'}
                size={20}
                color={selection.selected ? color.primary.default : color.text.tertiary}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            ) : null}
            {/* Mutually exclusive by construction: `needsAttention` means the server
                refused the row *and* nothing is queued for it (`db/queries.ts`). */}
            {item.needsAttention ? <NeedsAttentionGlyph /> : item.pending ? <PendingGlyph /> : null}
            {/* Decorative: the row's label says "private", and only its author ever sees this. */}
            {item.private ? (
              <Feather
                testID={`expense-private-${item.id}`}
                name="lock"
                size={14}
                color={color.text.tertiary}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            ) : null}
            <Text
              testID={`${EXPENSE_AMOUNT_TEST_ID_PREFIX}-${item.id}`}
              style={[styles.amount, item.kind === 'income' ? styles.income : null]}
              // The amount must never truncate or ellipsise: "a clipped amount is worse
              // than a taller row" (§Accessibility rule 4).
              numberOfLines={1}
            >
              {item.kind === 'income' ? '+' : ''}
              {formatMoney(item.amountMinor, item.currency)}
            </Text>
          </View>
        }
      >
        <RowTitle>{rowCategoryName(item)}</RowTitle>
        {item.needsAttention ? (
          // §5.1: the subtitle is *replaced*, not appended to. The note is the less
          // urgent of the two and the row only has one subtitle line.
          <Text style={styles.needsAttention} testID={`expense-needs-attention-${item.id}`}>
            {SYNC_COPY.row.needsAttention}
          </Text>
        ) : subtitle === null ? null : (
          // Omitted entirely when there is nothing to say, rather than rendered as an empty
          // line (`mutations.ts`, `normaliseNote`: `''` and `null` would otherwise differ).
          <RowSubtitle>{subtitle}</RowSubtitle>
        )}
      </Row>
    </SwipeToDelete>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
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
    income: { color: color.success.default },
    needsAttention: {
      ...type.footnote,
      color: color.danger.default,
    },
  }),
);
