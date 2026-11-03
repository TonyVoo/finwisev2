import type { Household, HouseholdMember } from '@expense-tracker/shared';
import { useCallback, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { AppBar, IconButton } from '@/components/Chrome';
import { Dialog } from '@/components/Dialog';
import { FormBanner } from '@/components/FormBanner';
import { Row, RowSubtitle, RowTitle } from '@/components/Row';
import { useSnackbar } from '@/components/Snackbar';
import { COPY } from '@/copy/strings';
import { useUserEmail } from '@/db/hooks';
import { memberLabel } from '@/household/addedBy';
import { BalancesSection } from '@/household/BalancesSection';
import { InviteSheet } from '@/household/InviteSheet';
import { MemberSheet } from '@/household/MemberSheet';
import { NameSheet } from '@/household/NameSheet';
import { useSpaces } from '@/household/useSpaces';
import { useBalances } from '@/household/useBalances';
import { householdErrorMessage, useHousehold, useHouseholdActions } from '@/household/useHousehold';
import { savedHaptic, warnHaptic } from '@/lib/haptics';
import { formatMoney } from '@/lib/money';
import { radius, space, type } from '@/theme/tokens';
import { createStyles } from '@/theme/ThemeProvider';

/**
 * One household (`docs/design/10-households.md`, `13-multiple-households.md`): who is in it, and the ways
 * in and out. Reached from the Households list with the household's `id`; with none it is the open
 * household, or the person's only one.
 *
 * Membership is server state, so this screen needs the network and says so plainly when it
 * has none. Joining and leaving also clear this device's rows and read the other books; the
 * actions (`useHouseholdActions`) refuse while changes are waiting to sync, since those would
 * be lost.
 */

type Confirming =
  | { readonly kind: 'leave' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'transfer'; readonly member: HouseholdMember }
  | { readonly kind: 'remove'; readonly member: HouseholdMember };

export default function HouseholdDetailScreen() {
  const styles = useStyles();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const household = useHousehold(id);
  const myEmail = useUserEmail().data;
  const actions = useHouseholdActions();

  const { active } = useSpaces();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState<string | undefined>(undefined);
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

  const rename = useCallback(
    async (householdId: string, name: string) => {
      setRenameError(undefined);
      try {
        await actions.rename(householdId, name);
        setRenameOpen(false);
        done(COPY.household.snack.renamed);
      } catch (error) {
        warnHaptic();
        setRenameError(householdErrorMessage(error));
      }
    },
    [actions, done],
  );

  const confirm = useCallback(
    async (householdId: string) => {
      const current = confirming;
      setConfirming(null);
      if (current === null) return;
      if (current.kind === 'leave') {
        await attempt(async () => {
          await actions.leave(householdId);
          router.back();
        }, COPY.household.snack.left);
      } else if (current.kind === 'transfer') {
        await attempt(
          () => actions.transfer(householdId, current.member.userId),
          COPY.household.snack.transferred,
        );
      } else if (current.kind === 'delete') {
        await attempt(async () => {
          await actions.deleteHousehold(householdId);
          router.back();
        }, COPY.household.snack.deleted);
      } else {
        await attempt(
          () => actions.removeMember(householdId, current.member.userId),
          COPY.household.snack.removed,
        );
      }
    },
    [actions, attempt, confirming, router],
  );

  const showInvite = useCallback(
    async (householdId: string) => {
      setBanner(null);
      try {
        setInviteCode(await actions.invite(householdId));
      } catch (error) {
        warnHaptic();
        setBanner(householdErrorMessage(error));
      }
    },
    [actions],
  );

  const data: Household | null | undefined = household.data;
  // Who owes whom: read from the rows this phone holds, for the members the screen is showing.
  const balances = useBalances(data?.members, data?.currency ?? '');

  return (
    <View style={styles.screen}>
      <AppBar
        title={household.data?.name ?? COPY.household.title}
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
          <View style={styles.centered} testID="household-gone">
            <Text style={styles.body}>{COPY.household.listEmpty}</Text>
          </View>
        ) : (
          <>
            {data.members.length >= 2 && balances.ready ? (
              <BalancesSection
                balances={balances}
                onSettle={() => router.push('/(app)/settings/settle-up')}
                onHistory={() => router.push('/(app)/settings/settlements')}
              />
            ) : null}
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
                      {[
                        isYou
                          ? `${COPY.household.role[member.role]} · ${COPY.household.you}`
                          : COPY.household.role[member.role],
                        // With only two people the Balances line already says it.
                        data.members.length >= 3
                          ? netText(balances.balances, member.userId, data.currency)
                          : null,
                      ]
                        .filter((part): part is string => part !== null)
                        .join(' · ')}
                    </RowSubtitle>
                  </Row>
                );
              })}
            </View>

            <View style={styles.actions}>
              {active?.kind === 'household' && active.householdId === data.id ? (
                <View style={styles.openNowCard}>
                  <View style={styles.dot} />
                  <Text style={styles.openNow} testID="household-open-now">
                    {COPY.household.openNow}
                  </Text>
                </View>
              ) : (
                <Button
                  label={COPY.household.switchTo}
                  variant="secondary"
                  onPress={() =>
                    void attempt(
                      () => actions.switchToHousehold(data.id),
                      COPY.spaces.switched.replace('{name}', data.name),
                    )
                  }
                  fullWidth
                  testID="household-switch"
                />
              )}
              {data.role === 'owner' ? (
                <>
                  <Button
                    label={COPY.household.invite.action}
                    onPress={() => void showInvite(data.id)}
                    fullWidth
                    testID="household-invite"
                  />
                  <Button
                    label={COPY.household.rename}
                    variant="secondary"
                    onPress={() => {
                      setRenameError(undefined);
                      setRenameOpen(true);
                    }}
                    fullWidth
                    testID="household-rename"
                  />
                  <View style={styles.danger}>
                    <Button
                      label={COPY.household.delete.action}
                      variant="destructive"
                      onPress={() => setConfirming({ kind: 'delete' })}
                      fullWidth
                      testID="household-delete"
                    />
                  </View>
                </>
              ) : (
                <View style={styles.danger}>
                  <Button
                    label={COPY.household.leave.action}
                    variant="destructive"
                    onPress={() => setConfirming({ kind: 'leave' })}
                    fullWidth
                    testID="household-leave"
                  />
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <NameSheet
        visible={renameOpen}
        mode="rename"
        initial={data?.name ?? ''}
        error={renameError}
        onClose={() => setRenameOpen(false)}
        onSubmit={(name) => (data ? rename(data.id, name) : Promise.resolve())}
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
        body={dialogBody(confirming, balances.unsettled)}
        destructive={{
          label: dialogConfirmLabel(confirming),
          onPress: () => data && void confirm(data.id),
        }}
        onCancel={() => setConfirming(null)}
        // Handing over destroys nothing, so it is not drawn like a deletion.
        confirmVariant={confirming?.kind === 'transfer' ? 'primary' : 'destructive'}
        testID={`household-${confirming?.kind ?? 'leave'}-dialog`}
      />
    </View>
  );
}

/** What a member is owed, or owes, overall; null when they are square. */
function netText(
  balances: readonly { readonly userId: string; readonly netMinor: number }[],
  userId: string,
  currency: string,
): string | null {
  const net = balances.find((balance) => balance.userId === userId)?.netMinor ?? 0;
  if (net === 0) return null;
  const amount = formatMoney(Math.abs(net), currency);
  return (net > 0 ? COPY.household.balances.isOwed : COPY.household.balances.owesNet).replace(
    '{amount}',
    amount,
  );
}

function dialogTitle(confirming: Confirming | null): string {
  if (confirming === null) return '';
  if (confirming.kind === 'transfer') {
    return COPY.household.transfer.title.replace('{email}', memberLabel(confirming.member));
  }
  if (confirming.kind === 'leave') return COPY.household.leave.title;
  if (confirming.kind === 'delete') return COPY.household.delete.title;
  return COPY.household.remove.title.replace('{email}', memberLabel(confirming.member));
}

/**
 * Leaving or removing someone changes everyone's balances, since they are worked out among
 * current members, so while anyone owes anyone the dialog says so. A warning only: settling up
 * first is the way to leave on good terms, but nothing stops you.
 */
function dialogBody(confirming: Confirming | null, unsettled: boolean): string {
  if (confirming === null) return '';
  if (confirming.kind === 'transfer') return COPY.household.transfer.body;
  if (confirming.kind === 'delete') return COPY.household.delete.body;
  if (confirming.kind === 'leave') {
    return unsettled
      ? `${COPY.household.leave.body}\n\n${COPY.household.balances.unsettledLeave}`
      : COPY.household.leave.body;
  }
  return unsettled
    ? `${COPY.household.remove.body}\n\n${COPY.household.balances.unsettledRemove}`
    : COPY.household.remove.body;
}

function dialogConfirmLabel(confirming: Confirming | null): string {
  if (confirming === null) return '';
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
      ...type.subhead,
      color: color.text.secondary,
      paddingHorizontal: space[5],
      paddingTop: space[4],
      paddingBottom: space[2],
    },
    group: {
      marginHorizontal: space[4],
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: color.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.border.hairline,
    },
    actions: { alignSelf: 'stretch', gap: space[3], padding: space[4], paddingTop: space[5] },
    openNowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      padding: space[3],
      borderRadius: radius.lg,
      backgroundColor: color.success.subtle,
    },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.success.default },
    openNow: { ...type.callout, color: color.success.default },
    danger: { marginTop: space[4] },
  }),
);
