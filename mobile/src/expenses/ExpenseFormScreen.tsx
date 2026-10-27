import { useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { AppBar, IconButton, SkeletonBlock } from '../components/Chrome';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { Row, RowTitle, Swatch } from '../components/Row';
import { useSnackbar } from '../components/Snackbar';
import { KindToggle } from './KindToggle';
import { CategoryFormSheet, type CategoryDraft } from '../categories/CategoryFormSheet';
import {
  CONFIRM_COPY,
  COPY,
  SNACK_COPY,
  categoryCreated,
  expenseSavedToMonth,
} from '../copy/strings';
import {
  useCategoriesWithCounts,
  useColoursInUse,
  useExpense,
  useFallbackCategory,
  useLastUsedCategoryId,
  useUserCurrency,
} from '../db/hooks';
import { useLocalWrite } from '../db/localWrite';
import {
  type ExpenseDraft,
  changedExpenseFields,
  createCategory,
  createExpense,
  deleteExpense,
  normaliseNote,
  restoreExpense,
  updateExpense,
} from '../db/mutations';
import { isCategoryNameTaken } from '../db/queries';
import { useDatabase } from '../db/DatabaseProvider';
import type { SqliteDatabase } from '../db/sqlite';
import {
  EMPTY_AMOUNT,
  type AmountInput,
  amountInputFrom,
  pressBackspace,
  pressDecimal,
  pressDigit,
} from '../lib/amount';
import { useApiClient } from '../bootstrap/AppProviders';
import { convertMinor, impliedRate, isValidRate } from '../lib/conversion';
import { currencyDecimals, formatMoney } from '../lib/money';
import { dateRowLabel, monthKeyOf, monthName, monthParts, spokenDate } from '../lib/calendar';
import { useSelectedMonth } from '../month/MonthProvider';
import { size, space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import { AmountDisplay } from './AmountDisplay';
import { CategorySheet } from './CategorySheet';
import { CurrencySheet } from './CurrencySheet';
import { useExchangeRate } from './useExchangeRate';
import { DateSheet } from './DateSheet';
import { Keypad } from './Keypad';
import { NoteSheet } from './NoteSheet';
import { RateSheet } from './RateSheet';
import { hasEdits, saveState } from './formModel';
import { getReceiptPicker, type PickOutcome } from '../receipts/receiptPicker';
import { ReceiptSheet } from '../receipts/ReceiptSheet';
import { attachReceipt, detachReceipt, hasReceipt } from '../receipts/receiptStore';
import { useReceipt } from '../receipts/useReceipt';

/**
 * Add / Edit expense: `docs/design/06-expense-form.md`.
 *
 * **One screen, two modes**, distinguished by whether an `expenseId` was passed. The
 * differences are confined to the title, the Delete button, the prefill and Save's
 * enablement, exactly as rule 1's table lists them - building two screens would invite
 * them to drift on the keypad, the sheets and the discard dialog they share.
 *
 * ### The amount
 *
 * Held as an **integer number of minor units**, with no string and no `parseFloat` at any
 * point (rule 2). The display is a `Text`, so a keyboard can never be focused into it.
 * Together those two facts are what let the spec promise there is no such thing as a
 * malformed amount here: it is not that bad input is validated, it is that bad input
 * cannot be constructed. All the arithmetic lives in `lib/amount.ts`.
 *
 * ### Saving
 *
 * One SQLite transaction containing both the row and its outbox entry, then
 * `router.back()` and a snackbar. **No spinner, no disabled-while-saving, nothing awaited
 * on the network** - "a save is as fast offline as online", which is the core offline
 * promise rather than an optimisation.
 *
 * An edit sends **only the fields that changed** (`changedExpenseFields`), because a push
 * is a merge: including an unchanged field would overwrite whatever another device wrote
 * there in the meantime.
 */

export const EXPENSE_FORM_TEST_ID = 'expense-form';
export const SAVE_TEST_ID = 'expense-save';
export const CLOSE_TEST_ID = 'expense-close';
export const DELETE_TEST_ID = 'expense-delete';
export const CATEGORY_ROW_TEST_ID = 'expense-category-row';
export const DATE_ROW_TEST_ID = 'expense-date-row';
export const NOTE_ROW_TEST_ID = 'expense-note-row';
export const NOT_FOUND_TEST_ID = 'expense-not-found';

/** Which sheet or dialog is up. One at a time; a sheet over a sheet has no spec. */
type Overlay =
  | 'none'
  | 'category'
  | 'date'
  | 'note'
  | 'receipt'
  | 'newCategory'
  | 'currency'
  | 'rate'
  | 'discard';

/**
 * What the person has done to the receipt photo in this form. Like every other field it is a
 * draft: nothing is stored until Save, and closing without saving discards it.
 */
type ReceiptChange =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'set'; readonly dataBase64: string }
  | { readonly kind: 'removed' };

export const RECEIPT_ROW_TEST_ID = 'expense-receipt-row';
export const CURRENCY_ROW_TEST_ID = 'expense-currency-row';
export const RATE_FIELD_TEST_ID = 'expense-rate-field';
export const CONVERTED_TEST_ID = 'expense-converted';

export interface ExpenseFormScreenProps {
  /** Edit mode when present, add mode when not. */
  readonly expenseId?: string;
}

export function ExpenseFormScreen({ expenseId }: ExpenseFormScreenProps) {
  const color = useColors();
  const styles = useStyles();
  const router = useRouter();
  const database = useDatabase();
  const showSnackbar = useSnackbar();
  const localWrite = useLocalWrite();
  const { today, select: selectMonth, month: selectedMonth } = useSelectedMonth();

  const isEdit = expenseId !== undefined;

  const stored = useExpense(expenseId ?? null);
  const categories = useCategoriesWithCounts();
  const fallback = useFallbackCategory();
  const lastUsed = useLastUsedCategoryId();
  const currency = useUserCurrency();
  const coloursInUse = useColoursInUse();

  const [amount, setAmount] = useState<AmountInput>(EMPTY_AMOUNT);
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [initial, setInitial] = useState<ExpenseDraft | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [rejections, setRejections] = useState(0);
  const [receiptChange, setReceiptChange] = useState<ReceiptChange>({ kind: 'unchanged' });
  // Paying in another currency. `null` is the account's own, which is almost always the case.
  const [entryCurrency, setEntryCurrency] = useState<string | null>(null);
  const [rateText, setRateText] = useState('');
  // True once the person has typed a rate, or reopened a stored one: a fetch never overwrites it.
  const [rateLocked, setRateLocked] = useState(false);
  const api = useApiClient();
  const storedReceipt = useReceipt(expenseId ?? null).data ?? null;

  const currencyCode = currency.data ?? null;
  const storedRow = isEdit ? (stored.data ?? null) : null;

  /**
   * Seed the draft once the reads it needs have returned.
   *
   * Add mode prefills the **last-used category, else the `isDefault` one** - read from
   * SQLite rather than from a persisted preference, so it is correct after a sync and
   * needs no migration (rule 1). Edit mode prefills from the row.
   */
  useEffect(() => {
    if (draft !== null || currencyCode === null) return;

    if (isEdit) {
      if (stored.isPending || stored.data === null || stored.data === undefined) return;
      const seeded: ExpenseDraft = {
        categoryId: stored.data.categoryId,
        kind: stored.data.kind,
        amountMinor: stored.data.amountMinor,
        currency: stored.data.currency,
        originalAmountMinor: stored.data.originalAmountMinor,
        originalCurrency: stored.data.originalCurrency,
        date: stored.data.date,
        note: stored.data.note,
      };
      setDraft(seeded);
      setInitial(seeded);
      if (stored.data.originalAmountMinor !== null && stored.data.originalCurrency !== null) {
        // Reopened in the currency it was paid in. Only the two amounts are stored, so the rate
        // is worked back out of them - and locked, so it is not replaced by today's.
        setEntryCurrency(stored.data.originalCurrency);
        setAmount(amountInputFrom(stored.data.originalAmountMinor));
        setRateText(
          impliedRate({
            originalMinor: stored.data.originalAmountMinor,
            originalDecimals: currencyDecimals(stored.data.originalCurrency),
            homeMinor: stored.data.amountMinor,
            homeDecimals: currencyDecimals(stored.data.currency),
          }) ?? '',
        );
        setRateLocked(true);
      } else {
        setAmount(amountInputFrom(stored.data.amountMinor));
      }
      return;
    }

    if (categories.isPending || lastUsed.isPending || fallback.isPending) return;
    const preselected = lastUsed.data ?? fallback.data?.id ?? categories.data?.[0]?.id ?? null;
    if (preselected === null) {
      // No live category at all. The form still renders - Save is disabled with
      // `Add a category first.` - so the user can reach the picker and create one.
      const seeded: ExpenseDraft = {
        categoryId: '',
        kind: 'expense',
        amountMinor: 0,
        currency: currencyCode,
        originalAmountMinor: null,
        originalCurrency: null,
        date: today,
        note: null,
      };
      setDraft(seeded);
      setInitial(seeded);
      return;
    }
    const seeded: ExpenseDraft = {
      categoryId: preselected,
      kind: 'expense',
      amountMinor: 0,
      currency: currencyCode,
      originalAmountMinor: null,
      originalCurrency: null,
      date: today,
      note: null,
    };
    setDraft(seeded);
    setInitial(seeded);
  }, [
    draft,
    currencyCode,
    isEdit,
    stored.isPending,
    stored.data,
    categories.isPending,
    categories.data,
    lastUsed.isPending,
    lastUsed.data,
    fallback.isPending,
    fallback.data,
    today,
  ]);

  // Which currency the keypad is typing in, and whether that needs converting.
  const foreign = entryCurrency !== null && entryCurrency !== currencyCode;
  const entryCode = foreign ? entryCurrency : (currencyCode ?? '');
  const homeDecimals = currencyCode === null ? 2 : currencyDecimals(currencyCode);
  // The keypad's decimal key follows the currency being typed, not the account's.
  const decimals = foreign ? currencyDecimals(entryCurrency) : homeDecimals;

  // What the typed amount comes to in the account currency. Null while there is no usable
  // rate, or when it would be too large to store - `rateProblem` says which.
  const converted = foreign
    ? convertMinor({
        amountMinor: amount.amountMinor,
        fromDecimals: decimals,
        toDecimals: homeDecimals,
        rate: rateText,
      })
    : amount.amountMinor;
  const rateProblem: 'missing' | 'overflow' | null = !foreign
    ? null
    : !isValidRate(rateText)
      ? 'missing'
      : converted === null
        ? 'overflow'
        : null;

  // The amount and the draft are two pieces of one value; the keypad owns the former. For a
  // foreign expense `amountMinor` is the converted amount - the one every total sums - and
  // what was typed is kept beside it as the original.
  const live: ExpenseDraft | null =
    draft === null
      ? null
      : {
          ...draft,
          amountMinor: converted ?? 0,
          originalAmountMinor: foreign ? amount.amountMinor : null,
          originalCurrency: foreign ? entryCurrency : null,
        };

  const rateStatus = useExchangeRate({
    api,
    from: foreign ? entryCurrency : null,
    home: currencyCode,
    date: draft?.date ?? null,
    today,
    locked: rateLocked,
    onRate: setRateText,
  });

  const liveCategories = categories.data ?? [];
  const chosenCategory = liveCategories.find((row) => row.id === live?.categoryId) ?? null;

  // What the form would leave the expense with, not what is stored.
  const receiptData =
    receiptChange.kind === 'set'
      ? receiptChange.dataBase64
      : receiptChange.kind === 'removed'
        ? null
        : (storedReceipt?.dataBase64 ?? null);
  const receiptPresent =
    receiptChange.kind === 'set'
      ? true
      : receiptChange.kind === 'removed'
        ? false
        : hasReceipt(storedReceipt);
  const receiptDirty = receiptChange.kind !== 'unchanged';

  const save = useMemo(
    () =>
      live === null
        ? { canSave: false }
        : saveState({
            // As typed, so the zero and range checks judge what the person sees; the
            // converted amount is judged through `rateProblem`.
            amountMinor: foreign ? amount.amountMinor : live.amountMinor,
            stored: storedRow,
            draft: live,
            hasCategories: liveCategories.length > 0,
            otherChange: receiptDirty,
            rateProblem,
          }),
    [
      live,
      storedRow,
      liveCategories.length,
      receiptDirty,
      foreign,
      amount.amountMinor,
      rateProblem,
    ],
  );

  const onDigit = useCallback(
    (digit: number) => {
      setAmount((current) => {
        const result = pressDigit(current, digit, decimals);
        if (result.rejected) {
          // Input is capped, not rejected: the display is unchanged and the user is told
          // why, rather than ending up with a value they must trim back (rule 5).
          setRejections((count) => count + 1);
          showSnackbar({ message: SNACK_COPY.amount.max });
        }
        return result.input;
      });
    },
    [decimals, showSnackbar],
  );

  const onClose = useCallback(() => {
    if (receiptDirty || (initial !== null && live !== null && hasEdits(initial, live))) {
      setOverlay('discard');
      return;
    }
    router.back();
  }, [initial, live, receiptDirty, router]);

  const onSave = useCallback(async () => {
    if (live === null || !save.canSave) return;

    if (storedRow !== null && expenseId !== undefined) {
      // Only what changed. A push is a merge, so sending an unchanged field would
      // overwrite whatever another device wrote there meanwhile.
      const changes = changedExpenseFields(storedRow, live);
      await localWrite(async (db) => {
        // A receipt-only edit changes no expense field, and an empty update is not a write.
        if (Object.keys(changes).length > 0) await updateExpense(db, expenseId, changes);
        await applyReceiptChange(db, expenseId, receiptChange);
      });
      router.back();
      showSnackbar({ message: SNACK_COPY.expense.updated });
      AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.updated);
      return;
    }

    await localWrite(async (db) => {
      const queued = await createExpense(db, {
        categoryId: live.categoryId,
        kind: live.kind,
        amountMinor: live.amountMinor,
        currency: live.currency,
        originalAmountMinor: live.originalAmountMinor,
        originalCurrency: live.originalCurrency,
        date: live.date,
        note: live.note,
      });
      await applyReceiptChange(db, queued.recordId, receiptChange);
    });
    router.back();

    // Rule 9: a save outside the month Home is showing says which month it landed in,
    // because the row will not be in the list the user returns to.
    const savedMonth = monthKeyOf(live.date);
    if (savedMonth === selectedMonth) {
      showSnackbar({ message: SNACK_COPY.expense.saved });
      AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.saved);
      return;
    }

    const message = expenseSavedToMonth(monthName(savedMonth), monthParts(savedMonth).year);
    showSnackbar({
      message,
      action: { label: COPY.common.view, onPress: () => selectMonth(savedMonth) },
    });
    AccessibilityInfo.announceForAccessibility(message);
  }, [
    live,
    save.canSave,
    storedRow,
    expenseId,
    receiptChange,
    localWrite,
    router,
    showSnackbar,
    selectedMonth,
    selectMonth,
  ]);

  const onPicked = useCallback(
    (outcome: PickOutcome, source: 'camera' | 'library') => {
      if (outcome.status === 'picked') {
        setReceiptChange({ kind: 'set', dataBase64: outcome.dataBase64 });
        setOverlay('none');
      } else if (outcome.status === 'denied') {
        showSnackbar({
          message:
            source === 'camera' ? COPY.form.receipt.deniedCamera : COPY.form.receipt.deniedLibrary,
        });
      } else if (outcome.status === 'failed') {
        showSnackbar({ message: COPY.form.receipt.failed });
      }
    },
    [showSnackbar],
  );

  const onDeleteExpense = useCallback(async () => {
    if (expenseId === undefined) return;

    // The same soft delete as the swipe on Home, and with no confirmation dialog for the
    // same reason: "two different confirmation models for one action would be worse than
    // either" (rule 12). This is the path assistive technology uses.
    await localWrite((db) => deleteExpense(db, expenseId));
    router.back();
    showSnackbar({
      message: SNACK_COPY.expense.deleted,
      action: {
        label: COPY.common.undo,
        onPress: () => {
          void localWrite((db) => restoreExpense(db, expenseId)).then(() => {
            AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.restored);
          });
        },
      },
    });
    AccessibilityInfo.announceForAccessibility(SNACK_COPY.expense.deleted);
  }, [expenseId, localWrite, router, showSnackbar]);

  const onCreateCategory = useCallback(
    async ({ name, color: hex, monthlyBudgetMinor }: CategoryDraft) => {
      const queued = await localWrite((db) =>
        createCategory(db, { name, color: hex, monthlyBudgetMinor }),
      );
      // Selected automatically, and **both** sheets dismiss: the user came here to pick a
      // category, not to manage them (rule 4).
      setDraft((current) =>
        current === null ? current : { ...current, categoryId: queued.recordId },
      );
      setOverlay('none');
      showSnackbar({ message: categoryCreated(name) });
    },
    [localWrite, showSnackbar],
  );

  // Edit mode with an id that is absent or tombstoned - a deep link, or the row was
  // deleted on another device (state `error` (b)). Not a network error; there is none here.
  if (isEdit && !stored.isPending && stored.data === null) {
    return <ExpenseNotFound onBack={() => router.back()} />;
  }

  return (
    <View testID={EXPENSE_FORM_TEST_ID} style={styles.screen}>
      <AppBar
        title={
          live?.kind === 'income'
            ? isEdit
              ? COPY.form.title.editIncome
              : COPY.form.title.addIncome
            : isEdit
              ? COPY.form.title.edit
              : COPY.form.title.add
        }
        centred
        leading={
          <IconButton
            icon="x"
            label={COPY.form.close}
            onPress={onClose}
            tint={color.text.primary}
            testID={CLOSE_TEST_ID}
          />
        }
        trailing={
          <Pressable
            testID={SAVE_TEST_ID}
            onPress={() => void onSave()}
            disabled={!save.canSave}
            accessibilityRole="button"
            accessibilityLabel={COPY.form.save}
            // The reason is on the amount's reserved line, which is in the reading order,
            // so a non-sighted user gets both the state and the explanation.
            accessibilityState={{ disabled: !save.canSave }}
            style={styles.saveTarget}
          >
            <Text style={[styles.save, save.canSave ? null : styles.saveDisabled]}>
              {COPY.form.save}
            </Text>
          </Pressable>
        }
      />

      {live === null ? (
        <FormSkeleton />
      ) : (
        <>
          <KindToggle
            value={live.kind}
            onChange={(kind) =>
              setDraft((current) => (current === null ? current : { ...current, kind }))
            }
          />
          <AmountDisplay
            amountMinor={amount.amountMinor}
            currency={entryCode}
            // Add mode's untouched zero reads as a placeholder rather than a value.
            muted={!isEdit && amount.amountMinor === 0}
            error={save.error}
            hint={save.hint}
          />

          {/* Scrolls between the amount and the keypad, with padding deep enough that
              Delete is always reachable - the keypad never covers content
              (§Accessibility rule 4). */}
          <ScrollView contentContainerStyle={styles.rows}>
            <Row
              testID={CURRENCY_ROW_TEST_ID}
              onPress={() => setOverlay('currency')}
              chevron
              leading={<Feather name="globe" size={20} color={color.text.tertiary} />}
              trailing={<Text style={styles.valueText}>{entryCode}</Text>}
              accessibilityLabel={`${COPY.form.currency.row}, ${entryCode}`}
              accessibilityHint="Double tap to pay in another currency."
            >
              <RowTitle>{COPY.form.currency.row}</RowTitle>
            </Row>

            {foreign && currencyCode !== null ? (
              <Row
                testID={RATE_FIELD_TEST_ID}
                onPress={() => setOverlay('rate')}
                chevron
                leading={<Feather name="repeat" size={20} color={color.text.tertiary} />}
                trailing={
                  <Text style={styles.valueText}>
                    {rateText !== ''
                      ? rateText
                      : rateStatus === 'loading'
                        ? COPY.form.rate.loading
                        : ''}
                  </Text>
                }
                accessibilityLabel={`${COPY.form.rate.label}, ${rateText}`}
                accessibilityHint="Double tap to type your own exchange rate."
              >
                <RowTitle>{COPY.form.rate.label}</RowTitle>
                {rateStatus === 'failed' && rateText === '' ? (
                  <Text style={styles.rateNote}>{COPY.form.rate.failed}</Text>
                ) : null}
                {converted !== null && amount.amountMinor > 0 ? (
                  <Text testID={CONVERTED_TEST_ID} style={styles.rateNote}>
                    {COPY.form.rate.converted.replace(
                      '{amount}',
                      formatMoney(converted, currencyCode),
                    )}
                  </Text>
                ) : null}
              </Row>
            ) : null}

            <Row
              testID={CATEGORY_ROW_TEST_ID}
              onPress={() => setOverlay('category')}
              chevron
              leading={<Feather name="tag" size={20} color={color.text.tertiary} />}
              trailing={
                chosenCategory === null ? null : (
                  <View style={styles.value}>
                    <Swatch colorHex={chosenCategory.color} diameter={16} />
                    <Text style={styles.valueText}>{chosenCategory.name}</Text>
                  </View>
                )
              }
              accessibilityLabel={`${COPY.form.field.category}, ${chosenCategory?.name ?? ''}`}
              accessibilityHint="Double tap to change category."
            >
              <RowTitle>{COPY.form.field.category}</RowTitle>
            </Row>

            <Row
              testID={DATE_ROW_TEST_ID}
              onPress={() => setOverlay('date')}
              chevron
              leading={<Feather name="calendar" size={20} color={color.text.tertiary} />}
              trailing={<Text style={styles.valueText}>{dateRowLabel(live.date, today)}</Text>}
              // Both forms: the relative word is what the user sees, the absolute date is
              // what makes it unambiguous read aloud (element 7).
              accessibilityLabel={`${COPY.form.field.date}, ${dateRowLabel(
                live.date,
                today,
              )}, ${spokenDate(live.date)}`}
            >
              <RowTitle>{COPY.form.field.date}</RowTitle>
            </Row>

            <Row
              testID={NOTE_ROW_TEST_ID}
              onPress={() => setOverlay('note')}
              chevron
              leading={<Feather name="file-text" size={20} color={color.text.tertiary} />}
              accessibilityLabel={
                live.note === null || live.note.length === 0
                  ? `${COPY.form.field.note}, empty`
                  : `${COPY.form.field.note}, ${live.note}`
              }
            >
              <RowTitle>{COPY.form.field.note}</RowTitle>
              <Text
                style={live.note === null ? styles.notePlaceholder : styles.noteValue}
                numberOfLines={2}
              >
                {live.note ?? COPY.form.field.notePlaceholder}
              </Text>
            </Row>

            <Row
              testID={RECEIPT_ROW_TEST_ID}
              onPress={() => setOverlay('receipt')}
              chevron
              lastInGroup
              leading={<Feather name="camera" size={20} color={color.text.tertiary} />}
              trailing={
                <Text style={styles.valueText}>
                  {receiptPresent ? COPY.form.field.receiptAttached : COPY.form.field.receiptAdd}
                </Text>
              }
              accessibilityLabel={`${COPY.form.field.receipt}, ${
                receiptPresent ? COPY.form.field.receiptAttached : COPY.form.field.receiptAdd
              }`}
            >
              <RowTitle>{COPY.form.field.receipt}</RowTitle>
            </Row>

            {isEdit ? (
              <View style={styles.deleteSlot}>
                <Button
                  testID={DELETE_TEST_ID}
                  label={live?.kind === 'income' ? COPY.form.deleteIncome : COPY.form.delete}
                  variant="ghost"
                  tone="danger"
                  fullWidth
                  onPress={() => void onDeleteExpense()}
                />
              </View>
            ) : null}
          </ScrollView>

          <Keypad
            onDigit={onDigit}
            onDecimal={() => setAmount((current) => pressDecimal(current).input)}
            onBackspace={() => setAmount((current) => pressBackspace(current).input)}
            decimals={decimals}
            rejectionCount={rejections}
          />
        </>
      )}

      <CategorySheet
        visible={overlay === 'category'}
        onClose={() => setOverlay('none')}
        categories={liveCategories}
        selectedId={live?.categoryId ?? null}
        onSelect={(id) => {
          setDraft((current) => (current === null ? current : { ...current, categoryId: id }));
          setOverlay('none');
        }}
        onCreateNew={() => setOverlay('newCategory')}
      />

      <CurrencySheet
        visible={overlay === 'currency'}
        onClose={() => setOverlay('none')}
        selected={entryCode}
        home={currencyCode ?? ''}
        onSelect={(code) => {
          const next = code === currencyCode ? null : code;
          // A different minor unit means the typed digits mean something else (1000 yen is
          // not 10.00 dollars), so they are cleared; between two-decimal currencies they stay.
          if (currencyDecimals(code) !== decimals) setAmount(EMPTY_AMOUNT);
          setEntryCurrency(next);
          // A new currency has a new rate: forget the old one, and let the lookup run again.
          setRateText('');
          setRateLocked(false);
          setOverlay('none');
        }}
      />

      <RateSheet
        visible={overlay === 'rate'}
        onClose={() => setOverlay('none')}
        rate={rateText}
        hint={COPY.form.rate.hint
          .replace('{from}', entryCode)
          .replace('{rate}', '?')
          .replace('{home}', currencyCode ?? '')}
        onDone={(rate) => {
          setRateText(rate);
          setRateLocked(true);
          setOverlay('none');
        }}
      />

      <DateSheet
        visible={overlay === 'date'}
        onClose={() => setOverlay('none')}
        selected={live?.date ?? today}
        today={today}
        onSelect={(date) => {
          setDraft((current) => (current === null ? current : { ...current, date }));
          setOverlay('none');
        }}
      />

      <NoteSheet
        visible={overlay === 'note'}
        onClose={() => setOverlay('none')}
        note={live?.note ?? ''}
        onDone={(note) => {
          setDraft((current) =>
            current === null ? current : { ...current, note: normaliseNote(note) },
          );
          setOverlay('none');
        }}
      />

      <ReceiptSheet
        visible={overlay === 'receipt'}
        onClose={() => setOverlay('none')}
        expenseId={expenseId ?? null}
        stored={storedReceipt}
        dataBase64={receiptData}
        present={receiptPresent}
        onTake={() =>
          void getReceiptPicker()
            .takePhoto()
            .then((o) => onPicked(o, 'camera'))
        }
        onChoose={() =>
          void getReceiptPicker()
            .chooseFromLibrary()
            .then((o) => onPicked(o, 'library'))
        }
        onRemove={() => {
          setReceiptChange({ kind: 'removed' });
          setOverlay('none');
        }}
      />

      <CategoryFormSheet
        // Only decides how many decimals the budget field takes; the sheet cannot open
        // before the form has its currency, so the fallback is never what the user sees.
        currency={currencyCode ?? 'USD'}
        visible={overlay === 'newCategory'}
        onClose={() => setOverlay('category')}
        editing={null}
        coloursInUse={coloursInUse.data ?? []}
        isNameTaken={(name) => isCategoryNameTaken(database, name)}
        onSubmit={onCreateCategory}
      />

      <Dialog
        visible={overlay === 'discard'}
        title={CONFIRM_COPY.discard.title}
        body={CONFIRM_COPY.discard.body}
        destructive={{
          label: CONFIRM_COPY.discard.confirm,
          onPress: () => {
            setOverlay('none');
            router.back();
          },
        }}
        // Scrim tap and Android back resolve as `Keep editing`, which is what `Dialog`
        // routes to `onCancel` - so the ambiguous exits never discard (rule 11).
        cancelLabel={CONFIRM_COPY.discard.cancel}
        onCancel={() => setOverlay('none')}
        testID="discard-dialog"
      />
    </View>
  );
}

/** Edit mode's single-frame skeleton while the row is read by id (state `loading`). */
function FormSkeleton() {
  const styles = useStyles();
  return (
    <View
      testID="form-skeleton"
      style={styles.skeleton}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SkeletonBlock width={120} height={34} />
      {[0, 1, 2].map((index) => (
        <SkeletonBlock key={index} width="100%" height={size.rowMinHeight} />
      ))}
    </View>
  );
}

function ExpenseNotFound({ onBack }: { readonly onBack: () => void }) {
  const color = useColors();
  const styles = useStyles();
  return (
    <View testID={NOT_FOUND_TEST_ID} style={styles.notFound}>
      <Feather
        name="alert-circle"
        size={48}
        color={color.text.tertiary}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.notFoundHeadline} accessibilityRole="header">
        {COPY.form.notFound.headline}
      </Text>
      <Text style={styles.notFoundBody}>{COPY.form.notFound.body}</Text>
      <Button
        label={COPY.form.notFound.action}
        variant="secondary"
        onPress={onBack}
        testID="not-found-back"
      />
    </View>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: color.bg.canvas,
    },
    saveTarget: {
      minWidth: size.tapTargetMin,
      minHeight: size.tapTargetMin,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    save: {
      ...type.bodyStrong,
      color: color.primary.default,
    },
    saveDisabled: {
      color: color.text.disabled,
    },
    rows: {
      paddingBottom: space[6],
    },
    value: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
    },
    rateNote: { ...type.callout, color: color.text.secondary, marginTop: space[1] },
    valueText: {
      ...type.body,
      color: color.text.secondary,
    },
    noteValue: {
      ...type.callout,
      color: color.text.secondary,
    },
    notePlaceholder: {
      ...type.callout,
      color: color.text.tertiary,
    },
    deleteSlot: {
      paddingHorizontal: space[4],
      paddingTop: space[6],
    },
    skeleton: {
      padding: space[4],
      gap: space[4],
    },
    notFound: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      paddingHorizontal: space[4],
    },
    notFoundHeadline: {
      ...type.title2,
      color: color.text.primary,
      marginTop: space[4],
    },
    notFoundBody: {
      ...type.callout,
      color: color.text.secondary,
      textAlign: 'center',
      marginBottom: space[4],
    },
  }),
);

/** Persist the form's receipt decision alongside the expense write that just happened. */
async function applyReceiptChange(
  db: SqliteDatabase,
  expenseId: string,
  change: ReceiptChange,
): Promise<void> {
  const at = new Date().toISOString();
  if (change.kind === 'set') await attachReceipt(db, expenseId, change.dataBase64, at);
  else if (change.kind === 'removed') await detachReceipt(db, expenseId, at);
}
