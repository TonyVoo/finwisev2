import type { HouseholdMember } from '@expense-tracker/shared';
import { StyleSheet, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { memberLabel } from './addedBy';
import { space } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';

export const MEMBER_SHEET_TEST_ID = 'household-member-sheet';
export const MEMBER_TRANSFER_TEST_ID = 'household-member-transfer';
export const MEMBER_REMOVE_TEST_ID = 'household-member-remove';

/** What the owner can do to a member: hand over the household, or remove them. */
export function MemberSheet({
  member,
  onClose,
  onTransfer,
  onRemove,
}: {
  /** `null` while closed. */
  readonly member: HouseholdMember | null;
  readonly onClose: () => void;
  readonly onTransfer: (member: HouseholdMember) => void;
  readonly onRemove: (member: HouseholdMember) => void;
}) {
  const styles = useStyles();

  return (
    <Sheet
      visible={member !== null}
      title={member === null ? '' : memberLabel(member)}
      onClose={onClose}
      testID={MEMBER_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <Button
          testID={MEMBER_TRANSFER_TEST_ID}
          label={COPY.household.memberSheet.transfer}
          variant="secondary"
          fullWidth
          onPress={() => member !== null && onTransfer(member)}
        />
        <Button
          testID={MEMBER_REMOVE_TEST_ID}
          label={COPY.household.memberSheet.remove}
          variant="destructive"
          fullWidth
          onPress={() => member !== null && onRemove(member)}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles(() =>
  StyleSheet.create({
    body: { gap: space[3], paddingBottom: space[4] },
  }),
);
