import type { Household, HouseholdMember } from '@expense-tracker/shared';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { AppBar, IconButton } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { EmptyIcon } from '@/components/EmptyIcon';
import { FormBanner } from '@/components/FormBanner';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { useSnackbar } from '@/components/Snackbar';
import { COPY } from '@/copy/strings';
import { useUserEmail } from '@/db/hooks';
import { memberLabel } from '@/household/addedBy';
import { InviteSheet } from '@/household/InviteSheet';
import { JoinSheet } from '@/household/JoinSheet';
import { MemberSheet } from '@/household/MemberSheet';
import {
  PendingChangesError,
  householdErrorMessage,
  useHousehold,
  useHouseholdActions,
} from '@/household/useHousehold';
import { savedHaptic, warnHaptic } from '@/lib/haptics';
import { space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * Household (`docs/design/10-households.md`): who shares these books, and the ways in and out.
 *
 * Membership is server state, so this screen needs the network and says so plainly when it
 * has none. Joining and leaving also clear this device's rows and read the other books; the
 * actions (`useHouseholdActions`) refuse while changes are waiting to sync, since those would
 * be lost.
 */

type Confirming =
  | { readonly kind: 'create' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'transfer'; readonly member: HouseholdMember }
  | { readonly kind: 'remove'; readonly member: HouseholdMember };

export default function HouseholdScreen() {
  const styles = useStyles();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const household = useHousehold();
  const myEmail = useUserEmail().data;
  const actions = useHouseholdActions();

  const [joinOpen, setJoinOpen] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>(undefined);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  /** The member whose action sheet is open. */
  const [actingOn, setActingOn] = useState<HouseholdMember | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const done = useCallback(
    (message: string) => {
      savedHaptic();
      showSnackbar({ message });
      AccessibilityInfo.announceForAccessibility(message);
    },
    [showSnackbar],
  );

  /** Run an action; a refusal becomes the banner, never a thrown error. */
  const attempt = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBanner(null);
      try {
        await action();
        done(success);
      } catch (error) {
        warnHaptic();
        setBanner(householdErrorMessage(error));
      }
    },
    [done],
  );

  const join = useCallback(
    async (code: string) => {
      setJoinError(undefined);
      try {
        await actions.join(code);
        setJoinOpen(false);
        done(COPY.household.snack.joined);
      } catch (error) {
        warnHaptic();
        setJoinError(
          error instanceof PendingChangesError ? error.message : householdErrorMessage(error),
        );
      }
    },
    [actions, done],
  );

  const confirm = useCallback(async () => {
    const current = confirming;
    setConfirming(null);
    if (current === null) return;
    if (current.kind === 'create') {
      await attempt(actions.create, COPY.household.snack.created);
    } else if (current.kind === 'leave') {
      await attempt(actions.leave, COPY.household.snack.left);
    } else if (current.kind === 'transfer') {
      await attempt(
        () => actions.transfer(current.member.userId),
        COPY.household.snack.transferred,
      );
    } else if (current.kind === 'delete') {
      await attempt(actions.deleteHousehold, COPY.household.snack.deleted);
    } else {
      await attempt(
        () => actions.removeMember(current.member.userId),
        COPY.household.snack.removed,
      );
    }
  }, [actions, attempt, confirming]);

  const showInvite = useCallback(async () => {
    setBanner(null);
    try {
      setInviteCode(await actions.invite());
    } catch (error) {
      warnHaptic();
      setBanner(householdErrorMessage(error));
    }
  }, [actions]);

  const data: Household | null | undefined = household.data;

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.household.title}
        leading={
          <IconButton
            icon="chevron-left"
            label={COPY.common.back}
            onPress={() => router.back()}
            testID="household-back"
          />
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        {banner === null ? null : <FormBanner message={banner} testID="household-banner" />}

        {household.isError ? (
          <View style={styles.centered}>
            <Text style={styles.body}>{householdErrorMessage(household.error)}</Text>
            <Button
              label={COPY.household.retry}
              variant="secondary"
              onPress={() => void household.refetch()}
              testID="household-retry"
            />
          </View>
        ) : data === undefined ? null : data === null ? (
          <View style={styles.centered} testID="household-empty">
            <EmptyIcon name="users" />
            <Text style={styles.headline} accessibilityRole="header">
              {COPY.household.empty.headline}
            </Text>
            <Text style={styles.body}>{COPY.household.empty.body}</Text>
            <View style={styles.actions}>
              <Button
                label={COPY.household.create}
                onPress={() => setConfirming({ kind: 'create' })}
                fullWidth
                testID="household-create"
              />
              <Button
                label={COPY.household.join}
                variant="secondary"
                onPress={() => {
                  setJoinError(undefined);
                  setJoinOpen(true);
                }}
                fullWidth
                testID="household-join"
              />
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.section} accessibilityRole="header">
              {COPY.household.members}
            </Text>
            <View style={styles.group}>
              {data.members.map((member, index) => {
                const isYou = member.email === myEmail;
                const canRemove = data.role === 'owner' && member.role !== 'owner';
                return (
                  <Row
                    key={member.userId}
                    testID={canRemove ? `household-member-${member.userId}` : undefined}
                    lastInGroup={index === data.members.length - 1}
                    onPress={canRemove ? () => setActingOn(member) : undefined}
                    accessibilityLabel={`${memberLabel(member)}, ${COPY.household.role[member.role]}`}
                    accessibilityHint={
                      canRemove
                        ? COPY.household.a11y.memberActions.replace('{email}', memberLabel(member))
                        : undefined
                    }
                  >
                    <RowTitle>{memberLabel(member)}</RowTitle>
                    <RowSubtitle>
                      {isYou
                        ? `${COPY.household.role[member.role]} · ${COPY.household.you}`
                        : COPY.household.role[member.role]}
                    </RowSubtitle>
                  </Row>
                );
              })}
            </View>

            <View style={styles.actions}>
              {data.role === 'owner' ? (
                <>
                  <Button
                    label={COPY.household.invite.action}
                    onPress={() => void showInvite()}
                    fullWidth
                    testID="household-invite"
                  />
                  <Button
                    label={COPY.household.delete.action}
                    variant="destructive"
                    onPress={() => setConfirming({ kind: 'delete' })}
                    fullWidth
                    testID="household-delete"
                  />
                </>
              ) : (
                <Button
                  label={COPY.household.leave.action}
                  variant="destructive"
                  onPress={() => setConfirming({ kind: 'leave' })}
                  fullWidth
                  testID="household-leave"
                />
              )}
            </View>
          </>
        )}
      </ScrollView>

      <JoinSheet
        visible={joinOpen}
        error={joinError}
        onClose={() => setJoinOpen(false)}
        onJoin={join}
      />
      <InviteSheet code={inviteCode} onClose={() => setInviteCode(null)} />
      <MemberSheet
        member={actingOn}
        onClose={() => setActingOn(null)}
        onTransfer={(member) => {
          setActingOn(null);
          setConfirming({ kind: 'transfer', member });
        }}
        onRemove={(member) => {
          setActingOn(null);
          setConfirming({ kind: 'remove', member });
        }}
      />

      <Dialog
        visible={confirming !== null}
        title={dialogTitle(confirming)}
        body={dialogBody(confirming)}
        destructive={{ label: dialogConfirmLabel(confirming), onPress: () => void confirm() }}
        onCancel={() => setConfirming(null)}
        // Creating and handing over destroy nothing, so they are not drawn like a deletion.
        confirmVariant={
          confirming?.kind === 'create' || confirming?.kind === 'transfer'
            ? 'primary'
            : 'destructive'
        }
        testID={`household-${confirming?.kind ?? 'leave'}-dialog`}
      />
    </View>
  );
}

function dialogTitle(confirming: Confirming | null): string {
  if (confirming === null) return '';
  if (confirming.kind === 'create') return COPY.household.createConfirm.title;
  if (confirming.kind === 'transfer') {
    return COPY.household.transfer.title.replace('{email}', memberLabel(confirming.member));
  }
  if (confirming.kind === 'leave') return COPY.household.leave.title;
  if (confirming.kind === 'delete') return COPY.household.delete.title;
  return COPY.household.remove.title.replace('{email}', memberLabel(confirming.member));
}

function dialogBody(confirming: Confirming | null): string {
  if (confirming === null) return '';
  if (confirming.kind === 'create') return COPY.household.createConfirm.body;
  if (confirming.kind === 'transfer') return COPY.household.transfer.body;
  if (confirming.kind === 'leave') return COPY.household.leave.body;
  if (confirming.kind === 'delete') return COPY.household.delete.body;
  return COPY.household.remove.body;
}

function dialogConfirmLabel(confirming: Confirming | null): string {
  if (confirming === null) return '';
  if (confirming.kind === 'create') return COPY.household.createConfirm.confirm;
  if (confirming.kind === 'transfer') return COPY.household.transfer.confirm;
  if (confirming.kind === 'leave') return COPY.household.leave.confirm;
  if (confirming.kind === 'delete') return COPY.household.delete.confirm;
  return COPY.household.remove.confirm;
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    content: { paddingBottom: space[8] },
    centered: { padding: space[6], gap: space[3], alignItems: 'center' },
    headline: { ...type.title1, color: color.text.primary, textAlign: 'center' },
    body: { ...type.body, color: color.text.secondary, textAlign: 'center' },
    section: {
      ...type.caption,
      color: color.text.tertiary,
      paddingHorizontal: space[4],
      paddingTop: space[4],
      paddingBottom: space[2],
    },
    group: { backgroundColor: color.bg.surface },
    actions: { alignSelf: 'stretch', gap: space[3], padding: space[4] },
  }),
);
