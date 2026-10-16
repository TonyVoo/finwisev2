import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { SyncPushRequest } from '@expense-tracker/shared';
import ExpenseListScreen, { HOME_LIST_TEST_ID } from '../../app/(app)/(tabs)/index';
import SummaryScreen, { SUMMARY_SCROLL_TEST_ID } from '../../app/(app)/(tabs)/summary';
import type { Transport, TransportRequest } from '@/api/transport';
import { updateExpense } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import { createMemoryReachability } from '@/sync/reachability';
import { mountScreen, ok } from '../support/mount';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';
import { applied, pullPage, pushResponse, serverExpense } from '../support/sync';

/**
 * Pull-to-refresh on both tabs, over the real engine and the real store.
 *
 * `docs/design/04-expense-list.md` §Behaviour rule 12 and `08-monthly-summary.md` rule 12,
 * which are the same rule: **the gesture is a sync, not a reload.** The screens are
 * already current - they read local SQLite - so there is nothing for a refresh to re-fetch,
 * and the only way it can change what is on screen is by bringing in rows another device
 * wrote. The two halves of `SYNC-35` are here as well: offline, the attempt stops
 * immediately, the pill carries the explanation, and nothing on the screen moves.
 */

/** 16 October 2026. Local components, so the suite's timezone cannot move the day. */
const NOW = new Date(2026, 9, 16, 9, 0, 0);

const GROCERIES = categoryId(1);

/** Pill state 4, verbatim from `09-copy-deck.md` §4 via `copy/strings.ts`. */
const OFFLINE_PILL = 'Offline. Your changes are saved on this device. Double tap for details.';

/** A server that accepts whatever it is sent and has nothing of its own to send back. */
const ACCEPTING_SERVER: Transport = async (request) => {
  if (request.path !== '/v1/sync') {
    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  }

  if (request.method === 'get') return ok(200, pullPage());

  const body = request.body as SyncPushRequest;
  return ok(
    200,
    pushResponse(
      body.changes.map((change) =>
        applied(change.clientMutationId, {
          entity: 'expense',
          record: serverExpense({ id: change.id, updatedAt: change.updatedAt, revision: 7 }),
        }),
      ),
    ),
  );
};

/** One settled expense of `$12.50`, and the user row the formatter needs. */
async function seedOneExpense(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: GROCERIES,
    amountMinor: 1250,
    date: '2026-10-08',
  });
}

function pulls(requests: readonly TransportRequest[]): number {
  return requests.filter((request) => request.method === 'get' && request.path === '/v1/sync')
    .length;
}

function pushes(requests: readonly TransportRequest[]): number {
  return requests.filter((request) => request.method === 'post' && request.path === '/v1/sync')
    .length;
}

function total(): string {
  return screen.getByTestId(MONTH_TOTAL_TEST_ID).props.accessibilityLabel as string;
}

function pillLabel(): string | null {
  const pill = screen.queryByTestId('sync-pill');
  return pill === null ? null : (pill.props.accessibilityLabel as string);
}

/** The gesture, on the scrollable the screen gave its refresh props to. */
async function pull(testID: string): Promise<void> {
  await act(async () => {
    fireEvent(screen.getByTestId(testID), 'refresh');
  });
}

function spinning(testID: string): boolean {
  return screen.getByTestId(testID).props.refreshing as boolean;
}

describe('a pull on Home', () => {
  it('asks the server for changes it has not seen', async () => {
    const { requests } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      transport: ACCEPTING_SERVER,
    });

    // The sync the engine runs on app open, which is not the one under test.
    await waitFor(() => expect(pulls(requests)).toBe(1));

    await pull(HOME_LIST_TEST_ID);

    await waitFor(() => expect(pulls(requests)).toBe(2));
  });

  /**
   * A change queued behind the app's back - written straight to the store rather than
   * through `useLocalWrite`, so the write trigger never fires - leaves the outbox
   * undrained and the pill reporting it. The pull is then the only thing that can drain
   * it, which is what makes this a push and not just a fetch.
   */
  it('drains the outbox, not merely pulls', async () => {
    const { database, requests } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      transport: ACCEPTING_SERVER,
    });
    await waitFor(() => expect(pulls(requests)).toBe(1));
    expect(pushes(requests)).toBe(0);

    await act(async () => {
      await updateExpense(database, expenseId(1), { amountMinor: 1900 });
    });

    await pull(HOME_LIST_TEST_ID);

    await waitFor(() => expect(pushes(requests)).toBe(1));
    // The drain cleared the entry, so the pill has nothing left to say (§3 rule 1).
    await waitFor(() => expect(pillLabel()).toBeNull());
  });

  /**
   * `SYNC-35`, first half. Aeroplane mode: the attempt is not made at all, because netinfo
   * has already answered the question a request would ask. No error banner, no toast, no
   * blanked list - the rows and the total stay exactly as they were, since they were never
   * read from the network in the first place.
   */
  it('makes no request offline, and shows no error', async () => {
    const { requests } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      reachability: createMemoryReachability(false),
      transport: ACCEPTING_SERVER,
    });
    await waitFor(() => expect(pillLabel()).toBe(OFFLINE_PILL));

    await pull(HOME_LIST_TEST_ID);

    expect(requests).toHaveLength(0);
    expect(total()).toContain('$12.50');
    expect(screen.getByText('Groceries')).toBeTruthy();
    // The pill is the whole explanation, and it is the quiet grey one rather than the red
    // one: a device in a tunnel has not failed at anything (§3 rule 3).
    expect(pillLabel()).toBe(OFFLINE_PILL);
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it('stops the spinner when the attempt is over', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      reachability: createMemoryReachability(false),
      transport: ACCEPTING_SERVER,
    });

    await pull(HOME_LIST_TEST_ID);

    // Offline the attempt is skipped rather than run, so this is the "stops immediately"
    // of rule 12 - one tick, not a timeout.
    await waitFor(() => expect(spinning(HOME_LIST_TEST_ID)).toBe(false));
  });
});

describe('a pull on Summary', () => {
  it('leaves every figure alone when the server has nothing new', async () => {
    const { requests } = await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      transport: ACCEPTING_SERVER,
    });
    await waitFor(() => expect(total()).toContain('$12.50'));

    await pull(SUMMARY_SCROLL_TEST_ID);

    await waitFor(() => expect(pulls(requests)).toBe(2));
    expect(total()).toContain('$12.50');
  });

  /**
   * The one thing a pull is allowed to change on this screen, and the reason the gesture
   * exists at all: a row written on another device arrives, and the aggregate is re-run
   * because the sync invalidated the reads - not because the screen re-queried on a
   * gesture.
   */
  it('shows a row that arrived from another device', async () => {
    let page = 0;
    const transport: Transport = async (request) => {
      if (request.method === 'get' && request.path === '/v1/sync') {
        page += 1;
        // Nothing on app open; the second answer - the pull's - carries the new row.
        return ok(
          200,
          page < 2
            ? pullPage()
            : pullPage({
                changes: [
                  {
                    entity: 'expense',
                    record: serverExpense({
                      id: expenseId(2),
                      categoryId: GROCERIES,
                      amountMinor: 1875,
                      date: '2026-10-09',
                      revision: 9,
                    }),
                  },
                ],
                nextCursor: 9,
              }),
        );
      }
      return await ACCEPTING_SERVER(request);
    };

    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      transport,
    });
    await waitFor(() => expect(total()).toContain('$12.50'));

    await pull(SUMMARY_SCROLL_TEST_ID);

    await waitFor(() => expect(total()).toContain('$31.25'));
  });

  /** `SYNC-35`, second half: the same gesture on the other tab, offline. */
  it('makes no request offline, and the figures stand', async () => {
    const { requests } = await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedOneExpense,
      startSync: true,
      reachability: createMemoryReachability(false),
      transport: ACCEPTING_SERVER,
    });
    await waitFor(() => expect(total()).toContain('$12.50'));

    await pull(SUMMARY_SCROLL_TEST_ID);

    expect(requests).toHaveLength(0);
    expect(total()).toContain('$12.50');
    expect(screen.queryByText(/failed/i)).toBeNull();
  });
});
