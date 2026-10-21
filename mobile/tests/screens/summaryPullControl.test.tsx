import { screen } from '@testing-library/react-native';
import ExpenseListScreen, { HOME_LIST_TEST_ID } from '../../app/(app)/(tabs)/index';
import SummaryScreen, { SUMMARY_SCROLL_TEST_ID } from '../../app/(app)/(tabs)/summary';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { mountScreen } from '../support/mount';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';

/**
 * `SYNC-61`. Pull-to-refresh does nothing at all on the Summary tab.
 *
 * Measured on a device (21 Oct, Pixel 9 / API 36 / Expo Go, through a logging proxy): the
 * same downward swipe that fires one `GET /v1/sync` from Home fires **zero** requests from
 * Summary. Four gesture variants were tried - different start heights, distances and
 * durations - and the proxy recorded nothing for any of them; switching to Home and
 * repeating the first variant produced a request immediately. So the gesture is reaching
 * the screen and the screen is not asking for a sync.
 *
 * The cause is a prop contract, not the hook. `usePullToRefresh` returns
 * `{ refreshing, onRefresh }`, and those are **`VirtualizedList` props**: a `FlatList` or
 * `SectionList` reads them and builds a `RefreshControl` for you. A plain `ScrollView` has
 * no such props - it takes a built control through `refreshControl` and ignores anything
 * else. Home spreads them onto a `SectionList` and works; `summary.tsx` spreads the same
 * two onto a `ScrollView`, where React Native drops them on the floor.
 *
 * ### Why `pullToRefresh.test.tsx` is green on three Summary cases
 *
 * Because it fires the gesture as `fireEvent(node, 'refresh')`, which calls the
 * `onRefresh` **prop** directly. That prop is present on the host node either way - the
 * question this case exists to ask is whether anything would ever *call* it, and firing it
 * yourself cannot ask that. That file's own comment records the reason for the choice (a
 * `RefreshControl` renders as an `RCTRefreshControl` with empty props under this preset, so
 * it is unreachable from a query), and the choice is a reasonable one; what it cost is this
 * defect, because the shape that made the test convenient is also the shape that does not
 * work on a `ScrollView`. Same family as `CAT-01` and `SYNC-51`: a case whose own mechanism
 * guaranteed it would pass.
 *
 * So this asserts the one thing that distinguishes the two screens and that a fired event
 * cannot fake - that each scrollable is handed refresh props **of the kind its own
 * component type reads**. The Home case is the control: it is the same assertion, it is
 * satisfied today, and it is what keeps this from being a rule invented for one screen.
 *
 * `it.failing` until `TVO-35` lands.
 */

const GROCERIES = categoryId(1);
const NOW = new Date(2026, 9, 16, 9, 0, 0);

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

describe('the refresh props each tab hands its scrollable', () => {
  /**
   * The control. Home's scrollable is a `SectionList`, which reads `refreshing` and
   * `onRefresh` and builds the control itself - so those two props are the right ones
   * there, and this case is what says so rather than leaving it implied.
   */
  it('are the ones a SectionList reads, on Home', async () => {
    await mountScreen(<ExpenseListScreen />, { clock: () => NOW, seed: seedOneExpense });

    const list = screen.getByTestId(HOME_LIST_TEST_ID);
    expect(typeof list.props.onRefresh).toBe('function');
    expect(typeof list.props.refreshing).toBe('boolean');
  });

  /**
   * `SYNC-61`. Summary's scrollable is a `ScrollView`, so the only prop that reaches
   * React Native is `refreshControl`. Today it has none, and the gesture is inert.
   */
  it.failing('are the ones a ScrollView reads, on Summary', async () => {
    await mountScreen(<SummaryScreen />, { clock: () => NOW, seed: seedOneExpense });

    expect(screen.getByTestId(SUMMARY_SCROLL_TEST_ID).props.refreshControl).toBeDefined();
  });
});
