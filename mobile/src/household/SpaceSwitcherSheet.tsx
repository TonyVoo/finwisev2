import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Row, RowSubtitle, RowTitle } from '../components/Row';
import { Sheet } from '../components/Sheet';
import { COPY } from '../copy/strings';
import { space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { spaceName } from './spaceModel';
import { householdErrorMessage, useHouseholdActions } from './useHousehold';
import { useSpaces } from './useSpaces';
import { useOptionalSyncStatus } from '../sync/SyncProvider';

export const SWITCHER_TEST_ID = 'space-switcher';
export const switcherRowTestId = (spaceId: string) => `space-row-${spaceId}`;
export const SWITCHER_MANAGE_TEST_ID = 'space-manage';

/**
 * The switcher: every book the account can work in, a check on the one open, and a way to the households
 * list. Switching needs the network (the other book's rows are not on the phone) and nothing waiting to
 * sync, and says which when it cannot - a row is never disabled without a reason shown.
 */
export function SpaceSwitcherSheet({
  visible,
  onClose,
  onManage,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onManage: () => void;
}) {
  const styles = useStyles();
  const color = useColors();
  const { spaces, active } = useSpaces();
  const actions = useHouseholdActions();
  const syncStatus = useOptionalSyncStatus();
  const offline = syncStatus !== null && !syncStatus.reachable;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (spaceId: string) => {
    setError(null);
    setBusy(true);
    try {
      await actions.switchTo(spaceId);
      onClose();
    } catch (failure) {
      setError(householdErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={COPY.spaces.switcherTitle}
      onClose={onClose}
      testID={SWITCHER_TEST_ID}
    >
      <View style={styles.body}>
        <View style={styles.group}>
          {spaces.map((candidate, index) => {
            const isActive = candidate.id === active?.id;
            return (
              <Row
                key={candidate.id}
                testID={switcherRowTestId(candidate.id)}
                lastInGroup={index === spaces.length - 1}
                onPress={isActive || offline || busy ? undefined : () => void choose(candidate.id)}
                accessibilityState={{ selected: isActive, disabled: !isActive && offline }}
                accessibilityLabel={
                  isActive
                    ? `${spaceName(candidate)}, ${COPY.spaces.current}`
                    : spaceName(candidate)
                }
                trailing={
                  isActive ? <Feather name="check" size={20} color={color.primary.default} /> : null
                }
              >
                <RowTitle>{spaceName(candidate)}</RowTitle>
                <RowSubtitle>{candidate.currency}</RowSubtitle>
              </Row>
            );
          })}
        </View>
        {offline ? <Text style={styles.note}>{COPY.spaces.offline}</Text> : null}
        {error === null ? null : (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Button
          testID={SWITCHER_MANAGE_TEST_ID}
          label={COPY.spaces.manage}
          variant="secondary"
          fullWidth
          onPress={onManage}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[3], paddingBottom: space[4] },
    group: { backgroundColor: color.bg.surface },
    note: { ...type.callout, color: color.text.secondary },
    error: { ...type.callout, color: color.danger.default },
  }),
);
