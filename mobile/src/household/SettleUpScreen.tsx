import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { AppBar, IconButton } from '../components/Chrome';
import { Row, RowTitle } from '../components/Row';
import { useSnackbar } from '../components/Snackbar';
import { COPY, SNACK_COPY, VALIDATION_COPY } from '../copy/strings';
import { useLocalWrite } from '../db/localWrite';
import { createSettlement, deleteSettlement } from '../db/mutations';
import { AmountDisplay } from '../expenses/AmountDisplay';
import { DateSheet } from '../expenses/DateSheet';
import { Keypad } from '../expenses/Keypad';
import { NoteSheet } from '../expenses/NoteSheet';
import { PaidBySheet } from '../expenses/PaidBySheet';
import {
  EMPTY_AMOUNT,
  amountInputFrom,
  pressBackspace,
  pressDecimal,
  pressDigit,
  type AmountInput,
} from '../lib/amount';
import { dateRowLabel } from '../lib/calendar';
import { savedHaptic } from '../lib/haptics';
import { currencyDecimals } from '../lib/money';
import { useSelectedMonth } from '../month/MonthProvider';
import { size, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { memberLabel } from './addedBy';
import { DirectionToggle } from './DirectionToggle';
import { startingPoint, suggestionWith } from './settleUpModel';
import { useBalances } from './useBalances';
import { useHousehold } from './useHousehold';

/**
 * Settle up (`docs/design/12-settle-up.md`): record that one member paid another.
 *
 * It starts from what you actually owe, or are owed - the person, the direction and the amount -
 * because that is nearly always what is being settled, and every part stays yours to change.
 * Typing an amount replaces the starting one rather than extending it. Picking someone else
 * restarts from what is owed with them, unless an amount has already been typed. Nothing is saved
 * until Record, and Record writes a local change that syncs like any other, with an Undo.
 */

type Overlay = 'none' | 'person' | 'date' | 'note';

interface Draft {
  readonly personId: string;
  readonly iPaid: boolean;
  readonly amount: AmountInput;
  /** True once a key has been pressed: from then on the amount is the person's, not a suggestion. */
  readonly touched: boolean;
  readonly date: string;
  readonly note: string;
}

export default function SettleUpScreen() {
  const styles = useStyles();
  const color = useColors();
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const { today } = useSelectedMonth();
  const household = useHousehold().data;
  const balances = useBalances(household?.members, household?.currency ?? '');
  const { meId, transfers } = balances;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');

  const others = (household?.members ?? []).filter((member) => member.userId !== meId);
  const currency = household?.currency ?? null;
  const decimals = currencyDecimals(currency ?? 'USD');

  // Start from what is owed, once the rows it depends on have been read.
  useEffect(() => {
    if (draft !== null || household === undefined || household === null || !balances.ready) return;
    if (meId === null) return;
    const start = startingPoint(
      transfers,
      meId,
      others.map((member) => member.userId),
    );
    if (start === null) return;
    setDraft({
      personId: start.personId,
      iPaid: start.iPaid,
      amount: amountInputFrom(start.amountMinor),
      touched: false,
      date: today,
      note: '',
    });
  }, [draft, household, balances.ready, meId, transfers, others, today]);

  const press = useCallback(
    (next: (current: AmountInput) => { input: AmountInput; rejected?: boolean }) => {
      setDraft((current) => {
        if (current === null) return current;
        // The first key replaces the starting amount instead of extending it.
        const result = next(current.touched ? current.amount : EMPTY_AMOUNT);
        if (result.rejected === true) showSnackbar({ message: SNACK_COPY.amount.max });
        return { ...current, amount: result.input, touched: true };
      });
    },
    [showSnackbar],
  );

  const choosePerson = useCallback(
    (personId: string) => {
      setDraft((current) => {
        if (current === null || meId === null) return current;
        if (current.touched) return { ...current, personId };
        const suggestion = suggestionWith(transfers, meId, personId);
        return {
          ...current,
          personId,
          iPaid: suggestion?.iPaid ?? current.iPaid,
          amount: amountInputFrom(suggestion?.amountMinor ?? 0),
        };
      });
      setOverlay('none');
    },
    [meId, transfers],
  );

  const amountMinor = draft?.amount.amountMinor ?? 0;
  const canRecord = draft !== null && meId !== null && amountMinor > 0;

  const record = useCallback(async () => {
    if (draft === null || meId === null || draft.amount.amountMinor <= 0) return;
    const queued = await localWrite((db) =>
      createSettlement(db, {
        fromUserId: draft.iPaid ? meId : draft.personId,
        toUserId: draft.iPaid ? draft.personId : meId,
        amountMinor: draft.amount.amountMinor,
        date: draft.date,
        note: draft.note,
      }),
    );
    savedHaptic();
    router.back();
    showSnackbar({
      message: COPY.household.settle.recorded,
      action: {
        label: COPY.common.undo,
        onPress: () => void localWrite((db) => deleteSettlement(db, queued.recordId)),
      },
    });
    AccessibilityInfo.announceForAccessibility(COPY.household.settle.recorded);
  }, [draft, meId, localWrite, router, showSnackbar]);

  const person = others.find((member) => member.userId === draft?.personId);
  const personName = person === undefined ? '' : memberLabel(person);

  return (
    <View style={styles.screen}>
      <AppBar
        title={COPY.household.settle.title}
        centred
        leading={
          <IconButton
            icon="x"
            label={COPY.household.settle.close}
            onPress={() => router.back()}
            tint={color.text.primary}
            testID="settle-close"
          />
        }
        trailing={
          <Pressable
            testID="settle-record"
            onPress={() => void record()}
            disabled={!canRecord}
            accessibilityRole="button"
            accessibilityLabel={COPY.household.settle.record}
            accessibilityState={{ disabled: !canRecord }}
            style={styles.recordTarget}
          >
            <Text style={[styles.record, canRecord ? null : styles.recordDisabled]}>
              {COPY.household.settle.record}
            </Text>
          </Pressable>
        }
      />

      {draft === null || currency === null ? null : (
        <>
          <DirectionToggle
            iPaid={draft.iPaid}
            onChange={(iPaid) =>
              setDraft((current) => (current === null ? current : { ...current, iPaid }))
            }
          />
          <AmountDisplay
            amountMinor={amountMinor}
            currency={currency}
            muted={amountMinor === 0}
            hint={amountMinor === 0 ? VALIDATION_COPY.amount.zero : undefined}
          />

          <ScrollView contentContainerStyle={styles.rows}>
            <Row
              testID="settle-person"
              onPress={() => setOverlay('person')}
              chevron
              leading={<Feather name="user" size={20} color={color.text.tertiary} />}
              trailing={<Text style={styles.valueText}>{personName}</Text>}
              accessibilityLabel={`${COPY.household.settle.person}, ${personName}`}
            >
              <RowTitle>{COPY.household.settle.person}</RowTitle>
            </Row>
            <Row
              testID="settle-date"
              onPress={() => setOverlay('date')}
              chevron
              leading={<Feather name="calendar" size={20} color={color.text.tertiary} />}
              trailing={<Text style={styles.valueText}>{dateRowLabel(draft.date, today)}</Text>}
              accessibilityLabel={`${COPY.form.field.date}, ${dateRowLabel(draft.date, today)}`}
            >
              <RowTitle>{COPY.form.field.date}</RowTitle>
            </Row>
            <Row
              testID="settle-note"
              onPress={() => setOverlay('note')}
              chevron
              leading={<Feather name="file-text" size={20} color={color.text.tertiary} />}
              trailing={
                <Text style={styles.valueText} numberOfLines={1}>
                  {draft.note.trim()}
                </Text>
              }
              accessibilityLabel={`${COPY.form.field.note}, ${draft.note.trim()}`}
            >
              <RowTitle>{COPY.form.field.note}</RowTitle>
            </Row>
          </ScrollView>

          <Keypad
            onDigit={(digit) => press((current) => pressDigit(current, digit, decimals))}
            onDecimal={() => press((current) => pressDecimal(current))}
            onBackspace={() => press((current) => pressBackspace(current))}
            decimals={decimals}
          />
        </>
      )}

      <PaidBySheet
        visible={overlay === 'person'}
        onClose={() => setOverlay('none')}
        options={others.map((member) => ({ userId: member.userId, label: memberLabel(member) }))}
        selectedId={draft?.personId ?? null}
        onSelect={choosePerson}
        title={COPY.household.settle.person}
      />
      <DateSheet
        visible={overlay === 'date'}
        onClose={() => setOverlay('none')}
        selected={draft?.date ?? today}
        today={today}
        onSelect={(date) => {
          setDraft((current) => (current === null ? current : { ...current, date }));
          setOverlay('none');
        }}
      />
      <NoteSheet
        visible={overlay === 'note'}
        onClose={() => setOverlay('none')}
        note={draft?.note ?? ''}
        onDone={(note) => {
          setDraft((current) => (current === null ? current : { ...current, note }));
          setOverlay('none');
        }}
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg.canvas },
    recordTarget: {
      minWidth: size.tapTargetMin,
      minHeight: size.tapTargetMin,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    record: { ...type.bodyStrong, color: color.primary.default },
    recordDisabled: { color: color.text.disabled },
    rows: { paddingBottom: space[6] },
    valueText: { ...type.body, color: color.text.secondary },
  }),
);
