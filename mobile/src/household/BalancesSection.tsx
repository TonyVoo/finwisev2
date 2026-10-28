import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Row, RowTitle } from '../components/Row';
import { COPY } from '../copy/strings';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import type { BalanceState } from './useBalances';

/**
 * Who owes whom, at the top of the Household screen once there are two or more members
 * (`docs/design/12-settle-up.md`). A line each, then Settle up and the history of payments.
 */
export function BalancesSection({
  balances,
  onSettle,
  onHistory,
}: {
  readonly balances: BalanceState;
  readonly onSettle: () => void;
  readonly onHistory: () => void;
}) {
  const styles = useStyles();
  return (
    <>
      <Text style={styles.section} accessibilityRole="header">
        {COPY.household.balances.title}
      </Text>
      <View style={styles.group} testID="balances">
        {balances.lines.map((line, index) => (
          <Row
            key={line.key}
            testID={`balance-line-${line.key}`}
            lastInGroup={index === balances.lines.length - 1}
          >
            <RowTitle>{line.text}</RowTitle>
          </Row>
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          label={COPY.household.balances.settleUp}
          onPress={onSettle}
          fullWidth
          testID="balances-settle"
        />
      </View>
      <View style={styles.group}>
        <Row
          testID="balances-history"
          chevron
          onPress={onHistory}
          lastInGroup
          accessibilityLabel={COPY.household.balances.history}
        >
          <RowTitle>{COPY.household.balances.history}</RowTitle>
        </Row>
      </View>
    </>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    section: {
      ...type.caption,
      color: color.text.tertiary,
      paddingHorizontal: space[4],
      paddingTop: space[4],
      paddingBottom: space[2],
    },
    group: { backgroundColor: color.bg.surface },
    actions: { alignSelf: 'stretch', paddingHorizontal: space[4], paddingVertical: space[3] },
  }),
);
