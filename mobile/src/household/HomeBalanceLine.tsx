import { Pressable, StyleSheet, Text } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COPY } from '../copy/strings';
import { useUserCurrency } from '../db/hooks';
import { space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { useBalances } from './useBalances';
import { useHouseholdMembers } from './useHouseholdMembers';

export const HOME_BALANCE_TEST_ID = 'home-balance';

/**
 * What you owe, or are owed, in a household: one line under the month total
 * (`docs/design/12-settle-up.md`). Read from this phone's own rows, so it works offline.
 *
 * It speaks only about you. What two other members owe each other is not Home's business, and
 * with several lines about you it shows the first and how many more. Nothing is drawn when you
 * are settled up, alone, or the rows are still being read: a line that says "settled" on every
 * visit would be noise on the busiest screen.
 */
export function HomeBalanceLine({ onOpen }: { readonly onOpen: () => void }) {
  const styles = useStyles();
  const color = useColors();
  const members = useHouseholdMembers();
  const currency = useUserCurrency().data ?? '';
  const balances = useBalances(members.length >= 2 ? members : undefined, currency);

  const mine = balances.lines.filter((line) => line.kind === 'youOwe' || line.kind === 'owesYou');
  const first = mine[0];
  if (!balances.ready || currency === '' || first === undefined) return null;

  const more = mine.length - 1;
  const text =
    more > 0
      ? `${first.text} · ${COPY.home.balanceMore.replace('{count}', String(more))}`
      : first.text;

  return (
    <Pressable
      testID={HOME_BALANCE_TEST_ID}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={COPY.home.balanceHint}
      style={styles.line}
    >
      <Feather name="users" size={14} color={color.text.secondary} />
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
      <Feather name="chevron-right" size={16} color={color.text.tertiary} />
    </Pressable>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      minHeight: 44,
    },
    text: { ...type.footnote, flex: 1, color: color.text.secondary },
  }),
);
