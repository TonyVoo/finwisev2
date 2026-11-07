import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';
import { COPY } from '../copy/strings';
import type { NewTrade } from '../db/mutations';
import type { TradeListItem } from '../db/queries';
import { nativePickText } from '../import/importExpenses';
import { space, type } from '../theme/tokens';
import { createStyles } from '../theme/ThemeProvider';
import { type SkipReason, planTradeImport } from './importTrades';
import { fillTemplate } from './investModel';

/**
 * Import trades from a broker's statement: choose a CSV file or paste its rows, see what would be added and what
 * would be left out and why, and only then add it - through the same local write as typing each trade, so it syncs
 * like any other. The text never leaves the phone.
 */

export const IMPORT_SHEET_TEST_ID = 'import-sheet';
export const IMPORT_PICK_TEST_ID = 'import-pick';
export const IMPORT_TEXT_TEST_ID = 'import-text';
export const IMPORT_SUBMIT_TEST_ID = 'import-submit';
export const IMPORT_SUMMARY_TEST_ID = 'import-summary';
export const IMPORT_UNREADABLE_TEST_ID = 'import-unreadable';

const SHOWN_SKIPS = 5;

function skipText(reason: SkipReason, line: number): string {
  const copy = COPY.portfolio;
  const template =
    reason === 'date'
      ? copy.skipDate
      : reason === 'symbol'
        ? copy.skipSymbol
        : reason === 'side'
          ? copy.skipSide
          : reason === 'quantity'
            ? copy.skipQuantity
            : reason === 'price'
              ? copy.skipPrice
              : reason === 'fee'
                ? copy.skipFee
                : reason === 'duplicate'
                  ? copy.skipDuplicate
                  : copy.skipColumns;
  return fillTemplate(template, { line });
}

export function ImportTradesSheet({
  visible,
  onClose,
  existing,
  onImport,
  pickText = nativePickText,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly existing: readonly TradeListItem[];
  readonly onImport: (trades: readonly NewTrade[]) => Promise<void>;
  /** The file chooser, replaceable in tests. */
  readonly pickText?: () => Promise<string | null>;
}) {
  const styles = useStyles();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) setText('');
  }, [visible]);

  const plan = useMemo(
    () => (text.trim() === '' ? null : planTradeImport(text, existing)),
    [text, existing],
  );
  const duplicates = plan?.skipped.filter((skip) => skip.reason === 'duplicate').length ?? 0;
  const unreadable = (plan?.skipped.length ?? 0) - duplicates;
  const problems = plan?.skipped.filter((skip) => skip.reason !== 'duplicate') ?? [];
  const count = plan?.trades.length ?? 0;

  async function choose(): Promise<void> {
    const picked = await pickText();
    if (picked !== null) setText(picked);
  }

  async function run(): Promise<void> {
    if (plan === null || count === 0 || busy) return;
    setBusy(true);
    try {
      await onImport(plan.trades.map((item) => item.trade));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      title={COPY.portfolio.importTitle}
      onClose={onClose}
      testID={IMPORT_SHEET_TEST_ID}
    >
      <View style={styles.body}>
        <Text style={styles.intro}>{COPY.portfolio.importIntro}</Text>
        <Button
          testID={IMPORT_PICK_TEST_ID}
          label={COPY.portfolio.chooseFile}
          variant="secondary"
          fullWidth
          onPress={() => void choose()}
        />
        <TextField
          testID={IMPORT_TEXT_TEST_ID}
          label={COPY.portfolio.pasteLabel}
          value={text}
          onChangeText={setText}
          autoCorrect={false}
          autoCapitalize="none"
        />

        {plan === null ? null : plan.unreadable ? (
          <Text testID={IMPORT_UNREADABLE_TEST_ID} style={styles.problem}>
            {COPY.portfolio.importUnreadable}
          </Text>
        ) : (
          <View style={styles.summary} testID={IMPORT_SUMMARY_TEST_ID}>
            <Text style={styles.ready}>{fillTemplate(COPY.portfolio.importReady, { count })}</Text>
            {duplicates > 0 ? (
              <Text style={styles.note}>
                {fillTemplate(COPY.portfolio.importDuplicates, { count: duplicates })}
              </Text>
            ) : null}
            {unreadable > 0 ? (
              <Text style={styles.problem}>
                {fillTemplate(COPY.portfolio.importSkipped, { count: unreadable })}
              </Text>
            ) : null}
            {problems.slice(0, SHOWN_SKIPS).map((skip) => (
              <Text key={`${skip.line}-${skip.reason}`} style={styles.note}>
                {skipText(skip.reason, skip.line)}
              </Text>
            ))}
            {plan.trades.some((item) => item.scaled) ? (
              <Text style={styles.note}>{COPY.portfolio.importScaled}</Text>
            ) : null}
          </View>
        )}

        <Button
          testID={IMPORT_SUBMIT_TEST_ID}
          label={fillTemplate(COPY.portfolio.importButton, { count })}
          variant="primary"
          fullWidth
          busy={busy}
          onPress={() => void run()}
        />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((color) =>
  StyleSheet.create({
    body: { gap: space[3], paddingBottom: space[4] },
    intro: { ...type.callout, color: color.text.secondary },
    summary: {
      gap: space[1],
      padding: space[3],
      borderRadius: 10,
      backgroundColor: color.bg.sunken,
    },
    ready: { ...type.bodyStrong, color: color.text.primary },
    note: { ...type.footnote, color: color.text.secondary },
    problem: { ...type.footnote, color: color.danger.default },
  }),
);
