import { useCallback, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSnackbar } from '../components/Snackbar';
import { COPY } from '../copy/strings';
import { useUserEmail } from '../db/hooks';
import { useLocalWrite } from '../db/localWrite';
import { setExpensesPrivate } from '../db/mutations';
import type { ExpenseListItem } from '../db/queries';
import { useHouseholdMembers } from './useHouseholdMembers';

/**
 * Picking several of your own expenses to make private, or shared, together.
 *
 * Only a household has anyone to hide an expense from, so only a household can start; and only
 * the author may change an expense's privacy, so only your own can be picked. An expense the
 * server has not yet stamped with an author (`createdBy` null) is one you just made.
 *
 * The screen keeps its own row behaviour and asks `rowProps` for the part that depends on a
 * selection being under way: a press toggles instead of opening.
 */

export interface ExpenseSelection {
  readonly active: boolean;
  readonly count: number;
  readonly cancel: () => void;
  readonly apply: (makePrivate: boolean) => Promise<void>;
  readonly rowProps: (
    item: ExpenseListItem,
    open: () => void,
  ) => {
    readonly onPress: () => void;
    readonly onLongPress: (() => void) | undefined;
    readonly selection: { readonly selected: boolean; readonly selectable: boolean } | undefined;
  };
}

export function useExpenseSelection(): ExpenseSelection {
  const members = useHouseholdMembers();
  const myEmail = useUserEmail().data;
  const localWrite = useLocalWrite();
  const showSnackbar = useSnackbar();
  const [ids, setIds] = useState<readonly string[]>([]);

  const inHousehold = members.length > 0;
  const isMine = useCallback(
    (createdBy: string | null) =>
      createdBy === null ||
      (myEmail !== null &&
        myEmail !== undefined &&
        members.some((member) => member.userId === createdBy && member.email === myEmail)),
    [members, myEmail],
  );

  const cancel = useCallback(() => setIds([]), []);

  const apply = useCallback(
    async (makePrivate: boolean) => {
      const chosen = ids;
      setIds([]);
      const changed = await localWrite((database) =>
        setExpensesPrivate(database, chosen, makePrivate),
      );
      if (changed.length === 0) return;
      const { madePrivateOne, madePrivateMany, madeSharedOne, madeSharedMany } =
        COPY.household.bulk;
      const message =
        changed.length === 1
          ? makePrivate
            ? madePrivateOne
            : madeSharedOne
          : (makePrivate ? madePrivateMany : madeSharedMany).replace(
              '{count}',
              String(changed.length),
            );
      AccessibilityInfo.announceForAccessibility(message);
      showSnackbar({
        message,
        action: {
          label: COPY.common.undo,
          onPress: () => {
            void localWrite((database) => setExpensesPrivate(database, changed, !makePrivate));
          },
        },
      });
    },
    [ids, localWrite, showSnackbar],
  );

  const toggle = useCallback(
    (id: string) =>
      setIds((current) =>
        current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
      ),
    [],
  );

  const rowProps: ExpenseSelection['rowProps'] = (item, open) => {
    const selectable = inHousehold && isMine(item.createdBy);
    if (ids.length === 0) {
      return {
        onPress: open,
        onLongPress: selectable ? () => setIds([item.id]) : undefined,
        selection: undefined,
      };
    }
    return {
      onPress: selectable ? () => toggle(item.id) : () => undefined,
      onLongPress: undefined,
      selection: { selected: ids.includes(item.id), selectable },
    };
  };

  return { active: ids.length > 0, count: ids.length, cancel, apply, rowProps };
}
