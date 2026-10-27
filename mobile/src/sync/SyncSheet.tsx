import { useState } from 'react';
import type { ColorTokens } from '../theme/tokens';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import {
  COPY,
  SYNC_COPY,
  lastSyncedLabel,
  syncSheetCopy,
  syncWaitingHeader,
  syncWaitingMore,
} from '../copy/strings';
import { usePendingChanges, useUserCurrency } from '../db/hooks';
import type { PendingChange } from '../db/queries';
import { formatMoney } from '../lib/money';
import { relativeTime } from '../lib/relativeTime';
import { space, type } from '../theme/tokens';
import { createStyles, useColors } from '../theme/ThemeProvider';
import type { SyncEngine, SyncStatus } from './engine';
import { syncPillState } from './state';

/**
 * The sync detail sheet: `docs/design/02-offline-and-sync.md` §4.
 *
 * The only place in the app where sync is explained in words, and the only place a manual
 * retry exists. Both of those are deliberate limits rather than an unfinished screen:
 *
 * - **`Try again` appears in the error state only** (§4 rule 1). In the offline and
 *   pending states a retry either cannot succeed or is about to happen anyway, and
 *   offering a button that does nothing teaches the user that buttons do nothing.
 * - **It is read-only otherwise** (rule 3). No per-item retry, no "discard this change",
 *   no editing. The list is where a change gets fixed.
 * - **It is reachable only through the pill**, which makes it unreachable in the idle
 *   state (rule 5). There is nothing to say there.
 */

/** §4, pending item: at most five, then a count of the rest. */
const MAX_ITEMS = 5;

export interface SyncSheetProps {
  readonly visible: boolean;
  readonly status: SyncStatus;
  readonly onClose: () => void;
  /** `Try again`, which runs a `manual` sync - the one trigger that ignores netinfo. */
  readonly onRetry: SyncEngine['sync'];
  /** Injected so a test can assert a relative time without waiting for one. */
  readonly now?: Date;
}

export function SyncSheet({ visible, status, onClose, onRetry, now }: SyncSheetProps) {
  const color = useColors();
  const styles = useStyles();
  const [retrying, setRetrying] = useState(false);
  const pending = usePendingChanges();
  const currency = useUserCurrency();

  const state = syncPillState(status);
  const { headline, body } = syncSheetCopy(state);
  const changes = pending.data ?? [];
  const shown = changes.slice(0, MAX_ITEMS);
  const hidden = changes.length - shown.length;

  async function retry(): Promise<void> {
    // Rule 2: the sheet enters a busy state for the attempt and updates in place. It does
    // not close - the result is what the user opened it to see.
    setRetrying(true);
    try {
      await onRetry('manual');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Sheet visible={visible} title={SYNC_COPY.sheet.title} onClose={onClose} testID="sync-sheet">
      <View style={styles.status}>
        <Feather
          name={STATUS_GLYPHS[state]}
          size={20}
          color={statusTintsFor(color)[state]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text style={styles.headline}>{headline}</Text>
      </View>
      <Text style={styles.body} testID="sync-sheet-body">
        {body}
      </Text>

      {changes.length > 0 ? (
        <View style={styles.changes}>
          <Text style={styles.sectionHeader} testID="sync-sheet-waiting">
            {syncWaitingHeader(changes.length)}
          </Text>
          {shown.map((change) => (
            <PendingRow
              key={`${change.entity}:${change.recordId}`}
              change={change}
              currency={currency.data ?? null}
            />
          ))}
          {hidden > 0 ? <Text style={styles.more}>{syncWaitingMore(hidden)}</Text> : null}
        </View>
      ) : null}

      <Text style={styles.lastSynced} testID="sync-sheet-last-synced">
        {lastSyncedLabel(
          status.lastSyncedAt === null
            ? null
            : relativeTime(new Date(status.lastSyncedAt), now ?? new Date()),
        )}
      </Text>

      {state === 'error' ? (
        <Button
          label={COPY.common.tryAgain}
          variant="secondary"
          fullWidth
          busy={retrying}
          onPress={() => void retry()}
          testID="sync-sheet-retry"
        />
      ) : null}
    </Sheet>
  );
}

/**
 * One queued change: category, amount, and what is queued for it.
 *
 * The amount is the formatted currency string and the row reads it aloud as one label,
 * because `$12.50` is read as money by both screen readers where `1250` is read as a
 * number (`00-foundations.md` §8 rule 3). A pending *category* has no amount, and its
 * label is simply the name and the operation.
 */
function PendingRow({
  change,
  currency,
}: {
  readonly change: PendingChange;
  readonly currency: string | null;
}) {
  const styles = useStyles();
  const operation = OPERATION_LABELS[change.operation];
  const amount =
    change.amountMinor === null || currency === null
      ? null
      : formatMoney(change.amountMinor, currency);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={[change.label, amount, operation].filter(Boolean).join(', ')}
      testID={`sync-sheet-item-${change.recordId}`}
    >
      <Text style={styles.rowLabel} numberOfLines={1}>
        {change.label}
      </Text>
      {amount === null ? null : <Text style={styles.rowAmount}>{amount}</Text>}
      <Text style={styles.rowOperation}>{operation}</Text>
    </View>
  );
}

const OPERATION_LABELS = {
  added: SYNC_COPY.sheet.added,
  edited: SYNC_COPY.sheet.edited,
  deleted: SYNC_COPY.sheet.deleted,
} as const;

const STATUS_GLYPHS = {
  idle: 'check' as const,
  syncing: 'refresh-cw' as const,
  pending: 'clock' as const,
  offline: 'cloud-off' as const,
  'offline-pending': 'cloud-off' as const,
  error: 'alert-circle' as const,
};

const statusTintsFor = (color: ColorTokens) => ({
  idle: color.text.secondary,
  syncing: color.info.default,
  pending: color.warning.default,
  offline: color.text.secondary,
  'offline-pending': color.warning.default,
  error: color.danger.default,
});

const useStyles = createStyles((color) =>
  StyleSheet.create({
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
    },
    headline: {
      ...type.bodyStrong,
      color: color.text.primary,
    },
    body: {
      ...type.callout,
      color: color.text.secondary,
      marginTop: space[2],
    },
    changes: {
      marginTop: space[4],
      gap: space[1],
    },
    sectionHeader: {
      ...type.caption,
      color: color.text.tertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      paddingVertical: space[1],
    },
    rowLabel: {
      ...type.callout,
      color: color.text.primary,
      flex: 1,
    },
    rowAmount: {
      ...type.callout,
      color: color.text.primary,
      fontVariant: ['tabular-nums'],
    },
    rowOperation: {
      ...type.callout,
      color: color.text.tertiary,
      minWidth: 56,
      textAlign: 'right',
    },
    more: {
      ...type.footnote,
      color: color.text.tertiary,
    },
    lastSynced: {
      ...type.footnote,
      color: color.text.tertiary,
      marginTop: space[4],
      marginBottom: space[2],
    },
  }),
);
