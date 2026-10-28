import { useCallback } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSnackbar } from '../components/Snackbar';
import { COPY, SNACK_COPY } from '../copy/strings';
import { useLocalWrite } from '../db/localWrite';
import { deleteExpense, restoreExpense } from '../db/mutations';
import { warnHaptic } from '../lib/haptics';

/**
 * Delete an expense with an undo, as Home and Search both do.
 *
 * Committed first, announced second: the snackbar reports something that has already happened.
 */
export function useDeleteExpense(): (id: string) => Promise<void> {
  const localWrite = useLocalWrite();
  const showSnackbar = useSnackbar();

  return useCallback(
    async (id: string) => {
      await localWrite((database) => deleteExpense(database, id));
      warnHaptic();
      AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.deleted);

      showSnackbar({
        message: SNACK_COPY.expense.deleted,
        action: {
          label: COPY.common.undo,
          onPress: () => {
            void localWrite((database) => restoreExpense(database, id)).then(() => {
              AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.restored);
            });
          },
        },
      });
    },
    [localWrite, showSnackbar],
  );
}
