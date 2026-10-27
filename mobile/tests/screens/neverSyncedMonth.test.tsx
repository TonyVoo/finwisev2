import { act, screen } from '@testing-library/react-native';
import ExpenseListScreen from '../../app/(app)/(tabs)/index';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import type { Transport } from '@/api/transport';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { EMPTY_COPY } from '@/copy/strings';
import { MONTH_TOTAL_SKELETON_TEST_ID, MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import { FIRST_PAINT_MS } from '@/expenses/useFirstPaint';
import { mountScreen } from '../support/mount';

/**
 * `TVO-34`, the half of it that is still open: **an empty store that has never synced is
 * presented as an empty month.**
 *
 * The trigger half of that bug does not reproduce in this tree - `SyncProvider` mounts
 * inside the signed-in route group and its effect calls `engine.start()`, which ends in
 * `sync('app-open')` (`src/sync/engine.ts:252`), so a returning user with a stored token
 * does get a pull. What reproduces is what the user sees while that pull is in flight,
 * and after it fails.
 *
 * `pending` on both tabs is driven by the **local read**, through `useFirstPaintSkeleton`,
 * which abandons the skeleton after 300ms "because after that the honest answer is
 * `empty`". For a first read of a store that genuinely holds nothing that is right. For a
 * store that holds nothing *because the first sync has not landed yet* it is not: the
 * honest answer there is "we do not know yet", and the screen instead states `$0.00`,
 * `0 expenses` and `No expenses yet` - with an `Add your first expense` button under it,
 * offered to someone who has hundreds. If the pull then fails, the red pill arrives beside
 * that, and the pair reads exactly like the app lost the data.
 *
 * Nothing in `ListStates.tsx` or `MonthTotal.tsx` knows whether a sync has ever completed;
 * `lastSyncedAt` is read by the engine and published in the status, and no screen consults
 * it. That is the gap, and it is why both cases below are `it.failing` rather than
 * assertions of something subtle.
 *
 * **These are the lock.** They were `it.failing` until `useAwaitingFirstSync` landed: both
 * tabs now hold their skeleton while no sync has ever completed and nothing is held locally,
 * and they state a figure only once there is one to state. They are the statement of what
 * "fixed" means on a device rather than in a unit - and a fix applied to one tab only would
 * fail the other.
 */

/** 16 October 2026, local, so the suite's timezone cannot move the day. */
const NOW = new Date(2026, 9, 16, 9, 0, 0);

/**
 * The returning user: a real user row, and not one expense.
 *
 * This is the state a cold start lands in before the first pull returns - the store is
 * created and owned, and empty. It is indistinguishable, locally, from a brand new
 * account, which is the whole difficulty: only "has a sync ever completed" separates them,
 * and that is exactly the fact the screens do not read.
 */
async function returningUserWithNothingPulledYet(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
}

/**
 * A server that does not answer until the case is over.
 *
 * The first pull stays in flight for the whole of each case, which is the window being
 * asserted about. A transport that resolved would make this a race between the sync and
 * the 300ms skeleton deadline, and a flaky test is worse than no test on a bug that has
 * been closed three times.
 *
 * Released in `afterEach` rather than left hanging: a promise that never settles keeps
 * the engine's `start()` awaiting forever and jest cannot exit, which is a worker leak
 * added to a suite that already has one (`TVO-21`).
 */
let releasePending: (() => void)[] = [];

const ANSWERS_WHEN_THE_CASE_IS_OVER: Transport = () =>
  new Promise((resolve) => {
    releasePending.push(() => {
      resolve({
        status: 200,
        body: {
          changes: [],
          nextCursor: 0,
          hasMore: false,
          resyncRequired: false,
          serverTime: NOW.toISOString(),
        },
        requestId: null,
      });
    });
  });

afterEach(() => {
  for (const release of releasePending) release();
  releasePending = [];
});

/**
 * Past the 300ms first-paint deadline, which is where the old behaviour gave up and stated
 * `$0.00`. The pull is still in flight, so what is on screen now is what a user with a slow
 * connection sees.
 */
async function pastTheSkeletonDeadline(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, FIRST_PAINT_MS + 150));
  });
}

/** The figure the screen states, or null when it states none (the skeleton is up). */
function statedTotal(): string | null {
  const total = screen.queryByTestId(MONTH_TOTAL_TEST_ID);
  return total === null ? null : (total.props.accessibilityLabel as string);
}

describe('Home, for an account whose first sync has not landed', () => {
  it('does not state $0.00 before anything has ever been pulled', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: returningUserWithNothingPulledYet,
      startSync: true,
      transport: ANSWERS_WHEN_THE_CASE_IS_OVER,
    });

    await pastTheSkeletonDeadline();

    // A figure is a claim. `$0.00` beside a sync that has never completed is a false one,
    // and it is the half of this screen that reads as data loss. What is shown instead is
    // the placeholder: no figure at all, until there is one to state.
    expect(statedTotal()).toBeNull();
    expect(
      screen.getByTestId(MONTH_TOTAL_SKELETON_TEST_ID, { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('does not offer "Add your first expense" to a user who may have hundreds', async () => {
    await mountScreen(<ExpenseListScreen />, {
      clock: () => NOW,
      seed: returningUserWithNothingPulledYet,
      startSync: true,
      transport: ANSWERS_WHEN_THE_CASE_IS_OVER,
    });

    await pastTheSkeletonDeadline();

    // The first-run empty state is a statement about the *account*, not about the store.
    // Reaching it from an unsynced cold start is the bug, independent of the total above:
    // a placeholder that fixed the figure and left this button would still be wrong.
    expect(screen.queryByText(EMPTY_COPY.home.firstRun.headline)).toBeNull();
  });
});

describe('Summary, for the same account', () => {
  it('does not state $0.00 before anything has ever been pulled', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: returningUserWithNothingPulledYet,
      startSync: true,
      transport: ANSWERS_WHEN_THE_CASE_IS_OVER,
    });

    await pastTheSkeletonDeadline();

    // Asserted on both tabs on purpose. They derive the same figure from the same read
    // through two different screens, so a fix applied to one of them is a fix to half the
    // bug - which is the shape the last three closures of `TVO-34` had.
    expect(statedTotal()).toBeNull();
    expect(
      screen.getByTestId(MONTH_TOTAL_SKELETON_TEST_ID, { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});
