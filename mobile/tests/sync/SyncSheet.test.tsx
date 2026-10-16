import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createExpense, deleteExpense, updateExpense } from '@/db/mutations';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import type { SyncStatus } from '@/sync/engine';
import { SyncSheet } from '@/sync/SyncSheet';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';
import { mountScreen } from '../support/mount';

/**
 * The sync detail sheet: `docs/design/02-offline-and-sync.md` §4.
 *
 * Mounted over a real database and real write helpers, because what the list shows is a
 * derivation over the outbox and the rows it references - `Added` against `Edited` comes
 * from whether the server has ever acknowledged the row, which no fixture built by hand
 * would keep honest.
 */

const BASE: SyncStatus = {
  reachable: true,
  inFlight: false,
  lastAttemptFailed: false,
  pendingRecords: 0,
  lastSyncedAt: null,
  resyncing: false,
  resyncProgress: null,
  lastError: null,
};

const NOW = new Date('2026-10-16T12:00:00.000Z');

async function mountSheet(
  status: Partial<SyncStatus>,
  options: {
    readonly seed?: (database: SqliteDatabase) => Promise<void>;
    readonly onRetry?: jest.Mock;
  } = {},
): Promise<jest.Mock> {
  const onRetry = options.onRetry ?? jest.fn(async () => undefined);

  await mountScreen(
    <SyncSheet
      visible
      status={{ ...BASE, ...status }}
      onClose={() => undefined}
      onRetry={onRetry as never}
      now={NOW}
    />,
    {
      seed: async (database) => {
        await writeUser(database, {
          id: '0192f5a0-0000-7000-8000-00000000a001',
          email: 'ada@example.com',
          currency: 'USD',
          createdAt: '2026-10-01T10:00:00.000Z',
        });
        await options.seed?.(database);
      },
    },
  );

  return onRetry;
}

/**
 * The pending list is a SQLite read, and it resolves a tick after mount - the same
 * convention every screen suite here follows.
 */
function itemLabel(recordId: string): string {
  return screen.getByTestId(`sync-sheet-item-${recordId}`).props.accessibilityLabel as string;
}

async function settled(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('sync-sheet-waiting')).not.toBeNull());
}

describe('what the sheet says about the state', () => {
  it('explains being offline without implying anything is broken', async () => {
    await mountSheet({ reachable: false });

    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByTestId('sync-sheet-body')).toHaveTextContent(
      'Your changes are saved on this device and will sync automatically when you are back online.',
    );
  });

  it('names the server as the thing that could not be reached', async () => {
    await mountSheet({ lastAttemptFailed: true });

    expect(screen.getByText('Sync failed')).toBeTruthy();
    expect(screen.getByTestId('sync-sheet-body')).toHaveTextContent(
      'We could not reach the server. Your changes are safe on this device.',
    );
  });

  it('reads Not synced yet on an install that has never synced', async () => {
    await mountSheet({});

    expect(screen.getByTestId('sync-sheet-last-synced')).toHaveTextContent('Not synced yet');
  });

  it('reports the last sync in words', async () => {
    await mountSheet({ lastSyncedAt: '2026-10-16T10:00:00.000Z' });

    expect(screen.getByTestId('sync-sheet-last-synced')).toHaveTextContent(
      'Last synced 2 hours ago',
    );
  });
});

describe('Try again', () => {
  /**
   * §4 rule 1. In the offline and pending states a retry either cannot succeed or is
   * about to happen anyway, and a button that does nothing teaches the user that buttons
   * do nothing.
   */
  it('is absent in every state but the error one', async () => {
    await mountSheet({ reachable: false, pendingRecords: 1 });
    expect(screen.queryByTestId('sync-sheet-retry')).toBeNull();
  });

  it('runs a manual sync, which is the one trigger that ignores netinfo', async () => {
    const onRetry = await mountSheet({ lastAttemptFailed: true });

    await act(async () => {
      fireEvent.press(screen.getByTestId('sync-sheet-retry'));
    });

    expect(onRetry).toHaveBeenCalledWith('manual');
    // Rule 2: the sheet updates in place. It does not close, so it is still here.
    expect(screen.getByText('Sync failed')).toBeTruthy();
  });
});

describe('the changes waiting', () => {
  it('shows no section at all when the outbox is empty', async () => {
    await mountSheet({});

    expect(screen.queryByTestId('sync-sheet-waiting')).toBeNull();
  });

  it('labels a never-synced row Added and an acknowledged one Edited', async () => {
    await mountSheet(
      { pendingRecords: 2 },
      {
        seed: async (database) => {
          await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
          await seedExpense(database, {
            id: expenseId(1),
            categoryId: categoryId(1),
            amountMinor: 1250,
            date: '2026-10-08',
          });

          // Revision 1 from the seed, so the server has seen it: an edit.
          await updateExpense(database, expenseId(1), { amountMinor: 1900 });
          // Never pushed, so revision 0: from the user's side this *is* its creation.
          await createExpense(
            database,
            {
              categoryId: categoryId(1),
              amountMinor: 320,
              currency: 'USD',
              date: '2026-10-09',
              note: null,
            },
            { id: expenseId(2) },
          );
        },
      },
    );

    await settled();
    expect(screen.getByTestId('sync-sheet-waiting')).toHaveTextContent('2 changes waiting');
    // Asserted on the spoken label, which is the row as one sentence - and where the
    // amount is the formatted currency string rather than `1900` (§8 rule 3).
    expect(itemLabel(expenseId(1))).toBe('Groceries, $19.00, Edited');
    expect(itemLabel(expenseId(2))).toBe('Groceries, $3.20, Added');
  });

  /**
   * §4 rule 4: a deleted item still shows the category and amount, read from the
   * tombstoned local row, so the list is not a column of blanks.
   */
  it('shows what a deleted expense was', async () => {
    await mountSheet(
      { pendingRecords: 1 },
      {
        seed: async (database) => {
          await seedCategory(database, { id: categoryId(1), name: 'Transport' });
          await seedExpense(database, {
            id: expenseId(1),
            categoryId: categoryId(1),
            amountMinor: 320,
            date: '2026-10-08',
          });
          await deleteExpense(database, expenseId(1));
        },
      },
    );

    await settled();
    expect(itemLabel(expenseId(1))).toBe('Transport, $3.20, Deleted');
  });

  it('counts three edits to one expense as one waiting change', async () => {
    await mountSheet(
      { pendingRecords: 1 },
      {
        seed: async (database) => {
          await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
          await seedExpense(database, {
            id: expenseId(1),
            categoryId: categoryId(1),
            amountMinor: 1250,
            date: '2026-10-08',
          });
          await updateExpense(database, expenseId(1), { amountMinor: 1300 });
          await updateExpense(database, expenseId(1), { amountMinor: 1400 });
          await updateExpense(database, expenseId(1), { amountMinor: 1500 });
        },
      },
    );

    // §3 rule 5 counts records, not entries, and the sheet's header has to agree with the
    // pill above it.
    await settled();
    expect(screen.getByTestId('sync-sheet-waiting')).toHaveTextContent('1 change waiting');
  });

  it('lists five changes and counts the rest', async () => {
    await mountSheet(
      { pendingRecords: 7 },
      {
        seed: async (database) => {
          await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
          for (let index = 1; index <= 7; index += 1) {
            await createExpense(
              database,
              {
                categoryId: categoryId(1),
                amountMinor: 100 * index,
                currency: 'USD',
                date: '2026-10-09',
                note: null,
              },
              { id: expenseId(index) },
            );
          }
        },
      },
    );

    await settled();
    expect(screen.getByTestId('sync-sheet-waiting')).toHaveTextContent('7 changes waiting');
    expect(screen.getByTestId(`sync-sheet-item-${expenseId(5)}`)).toBeTruthy();
    expect(screen.queryByTestId(`sync-sheet-item-${expenseId(6)}`)).toBeNull();
    expect(screen.getByText('and 2 more')).toBeTruthy();
  });
});
