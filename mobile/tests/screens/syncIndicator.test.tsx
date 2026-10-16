import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { SyncPushRequest } from '@expense-tracker/shared';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import { updateExpense } from '@/db/mutations';
import type { SqliteDatabase } from '@/db/sqlite';
import type { Transport } from '@/api/transport';
import { createMemoryReachability } from '@/sync/reachability';
import { mountScreen, ok } from '../support/mount';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';
import { applied, pullPage, pushResponse, serverExpense } from '../support/sync';

/**
 * The pill in Home's app bar, over the real engine and the real store.
 *
 * `docs/design/02-offline-and-sync.md` §3 puts the pill on Home and Summary and nowhere
 * else, and this is the suite that holds the whole path together: a queued local write,
 * the engine that drains it, netinfo deciding whether to try, and the pill reporting the
 * result. The parts are tested in isolation elsewhere - what is only testable here is
 * that they are wired to each other at all.
 */

const NOW = new Date('2026-10-16T12:00:00.000Z');

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

async function seedOneQueuedEdit(database: SqliteDatabase): Promise<void> {
  await seedCategory(database, { id: categoryId(1), name: 'Groceries' });
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: categoryId(1),
    amountMinor: 1250,
    date: '2026-10-08',
  });
  // A real write, so the outbox entry and its `clientMutationId` are real too.
  await updateExpense(database, expenseId(1), { amountMinor: 1900 });
}

function pillLabel(): string | null {
  const pill = screen.queryByTestId('sync-pill');
  return pill === null ? null : (pill.props.accessibilityLabel as string);
}

function pushes(requests: readonly { method: string; path: string }[]): number {
  return requests.filter((request) => request.method === 'post' && request.path === '/v1/sync')
    .length;
}

describe('the pill on Home', () => {
  it('is absent entirely when there is nothing to report', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      startSync: true,
      transport: ACCEPTING_SERVER,
    });

    // State 1 renders nothing at all - not an empty pill, not a tick (§3 rule 1). The
    // slot stays, hidden from the accessibility tree, so the title cannot move (rule 7).
    await waitFor(() =>
      expect(
        screen.queryByTestId('sync-pill-empty', { includeHiddenElements: true }),
      ).not.toBeNull(),
    );
    expect(screen.queryByTestId('sync-pill')).toBeNull();
  });

  it('reports a queued change, and that the device cannot send it', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneQueuedEdit,
      startSync: true,
      reachability: createMemoryReachability(false),
      transport: ACCEPTING_SERVER,
    });

    await waitFor(() =>
      expect(pillLabel()).toBe('Offline, 1 change waiting to sync. Double tap for details.'),
    );
  });

  it('opens the sync sheet when tapped, and the sheet explains the state', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneQueuedEdit,
      startSync: true,
      reachability: createMemoryReachability(false),
      transport: ACCEPTING_SERVER,
    });
    await waitFor(() => expect(pillLabel()).not.toBeNull());

    await act(async () => {
      fireEvent.press(screen.getByTestId('sync-pill'));
    });

    expect(screen.getByText('Offline')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('sync-sheet-waiting')).toHaveTextContent('1 change waiting'),
    );
  });
});

/**
 * The second of the two screens §3 puts the pill on - and the reason it is tested twice
 * rather than once: the pill is wired per screen, so a tab that forgot it would be a pill
 * that silently does not exist on half the app while every unit test of it still passed.
 */
describe('the pill on Summary', () => {
  it('is absent entirely when there is nothing to report', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      startSync: true,
      transport: ACCEPTING_SERVER,
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId('sync-pill-empty', { includeHiddenElements: true }),
      ).not.toBeNull(),
    );
    expect(screen.queryByTestId('sync-pill')).toBeNull();
  });

  it('reports a queued change, and opens the same sheet Home does', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedOneQueuedEdit,
      startSync: true,
      reachability: createMemoryReachability(false),
      transport: ACCEPTING_SERVER,
    });

    await waitFor(() =>
      expect(pillLabel()).toBe('Offline, 1 change waiting to sync. Double tap for details.'),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('sync-pill'));
    });

    expect(screen.getByText('Offline')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('sync-sheet-waiting')).toHaveTextContent('1 change waiting'),
    );
  });
});

describe('with the triggers wired', () => {
  it('pushes the queued change on app open, and the pill goes quiet', async () => {
    const { requests } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneQueuedEdit,
      startSync: true,
      transport: ACCEPTING_SERVER,
    });

    await waitFor(() => expect(pushes(requests)).toBe(1));
    // The drain cleared the entry, so the pill has nothing left to say - and says it by
    // disappearing rather than by congratulating anyone (§3 rule 1, §2 rule 3).
    await waitFor(() => expect(pillLabel()).toBeNull());
  });

  /**
   * The offline branch, end to end. An unreachable device does not spend a radio wake-up
   * to learn what netinfo already said, and the pill reads grey and quiet rather than
   * `Sync failed` - which is the distinction the whole four-input design exists for.
   */
  it('makes no request while netinfo says unreachable, and says Offline', async () => {
    const reachability = createMemoryReachability(false);

    const { requests } = await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: seedOneQueuedEdit,
      startSync: true,
      reachability,
      transport: ACCEPTING_SERVER,
    });

    await waitFor(() =>
      expect(pillLabel()).toBe('Offline, 1 change waiting to sync. Double tap for details.'),
    );
    expect(pushes(requests)).toBe(0);

    // Connectivity coming back is its own trigger, and it is the engine that owns it.
    await act(async () => {
      reachability.set(true);
    });

    await waitFor(() => expect(pushes(requests)).toBe(1));
    await waitFor(() => expect(pillLabel()).toBeNull());
  });
});
