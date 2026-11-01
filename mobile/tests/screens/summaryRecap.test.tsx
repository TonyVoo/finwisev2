import { screen, userEvent, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import type { SqliteDatabase } from '@/db/sqlite';
import { writeUser } from '@/db/user';
import { MONTH_TOTAL_TEST_ID } from '@/expenses/MonthTotal';
import { MONTH_NEXT_TEST_ID, MONTH_PREVIOUS_TEST_ID } from '@/month/MonthSwitcher';
import { INSIGHTS_TEST_ID } from '@/summary/InsightsCard';
import {
  RECAP_BUTTON_TEST_ID,
  RECAP_TEXT_TEST_ID,
  resetRecapStateForTests,
} from '@/summary/RecapSection';
import { writeLastSyncedAt } from '@/sync/cursor';
import { createMemoryReachability } from '@/sync/reachability';
import { categoryColor } from '@/theme/tokens';
import SummaryScreen from '../../app/(app)/(tabs)/summary';
import { apiError, mountScreen, ok, pressOn, type MountedScreen } from '../support/mount';
import { resetRouter } from '../support/router';
import {
  categoryId,
  expenseId,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * The recap on the Summary Insights card (`docs/design/16-monthly-insights.md`): a button that asks the server
 * to reword the card's own sentences. Tapping it is the act; every way it can fail leaves the card exactly as
 * it was, and a recap is kept for the session only, in memory.
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const HOUSING = categoryId(1);
const GROCERIES = categoryId(2);
const RECAP = 'October was heavier than September, with groceries leading.';

async function seedMonths(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await writeLastSyncedAt(database, '2026-10-16T08:00:00.000Z');
  await seedFallbackCategory(database);
  await seedCategory(database, { id: HOUSING, name: 'Housing', color: categoryColor.blue });
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: categoryColor.green });
  // October, with enough in it for insights; September and August, so both months have a card.
  await seedExpense(database, {
    id: expenseId(1),
    categoryId: HOUSING,
    amountMinor: 52000,
    date: '2026-10-01',
  });
  await seedExpense(database, {
    id: expenseId(2),
    categoryId: GROCERIES,
    amountMinor: 31000,
    date: '2026-10-09',
  });
  await seedExpense(database, {
    id: expenseId(3),
    categoryId: HOUSING,
    amountMinor: 50000,
    date: '2026-09-02',
  });
  await seedExpense(database, {
    id: expenseId(4),
    categoryId: GROCERIES,
    amountMinor: 12000,
    date: '2026-09-12',
  });
  await seedExpense(database, {
    id: expenseId(5),
    categoryId: GROCERIES,
    amountMinor: 9000,
    date: '2026-08-12',
  });
}

function recapReturns(response: TransportResponse) {
  return async (request: TransportRequest): Promise<TransportResponse> => {
    if (request.method === 'post' && request.path === '/v1/recap') return response;
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  };
}

async function mountSummary(
  response: TransportResponse = ok(200, { data: { text: RECAP } }),
  extra: { reachability?: ReturnType<typeof createMemoryReachability> } = {},
): Promise<MountedScreen> {
  const mounted = await mountScreen(<SummaryScreen />, {
    clock: () => NOW,
    seed: seedMonths,
    transport: recapReturns(response),
    ...extra,
  });
  await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());
  await waitFor(() => expect(screen.queryByTestId(INSIGHTS_TEST_ID)).not.toBeNull());
  return mounted;
}

const recapRequests = (requests: readonly TransportRequest[]) =>
  requests.filter((request) => request.path === '/v1/recap');

beforeEach(() => {
  resetRouter();
  resetRecapStateForTests();
});

describe('the recap button', () => {
  it('is on the card with a hint saying where the sentences go, and sends nothing until pressed', async () => {
    const { requests } = await mountSummary();

    expect(screen.getByTestId(RECAP_BUTTON_TEST_ID)).toBeTruthy();
    expect(screen.getByText(COPY.summary.recap.hint)).toBeTruthy();
    expect(COPY.summary.recap.hint).toMatch(/outside service/);
    expect(requests).toEqual([]);
    expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).toBeNull();
  });

  it('is not there when the card has nothing to say', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      transport: recapReturns(ok(200, { data: { text: RECAP } })),
      seed: async (database) => {
        await writeUser(database, {
          id: '0192f5a0-0000-7000-8000-00000000a001',
          email: 'ada@example.com',
          currency: 'USD',
          createdAt: '2026-10-01T00:00:00.000Z',
        });
        await writeLastSyncedAt(database, '2026-10-16T08:00:00.000Z');
        await seedFallbackCategory(database);
      },
    });
    await waitFor(() => expect(screen.queryByTestId(MONTH_TOTAL_TEST_ID)).not.toBeNull());

    expect(screen.queryByTestId(RECAP_BUTTON_TEST_ID)).toBeNull();
  });
});

describe('asking for a recap', () => {
  it("sends the month, the language and exactly the card's own sentences, and nothing else", async () => {
    const { requests } = await mountSummary();

    await pressOn(RECAP_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).not.toBeNull());
    const [request] = recapRequests(requests);
    const body = (request as { body: { month: string; language: string; facts: string[] } }).body;
    expect(Object.keys(body).sort()).toEqual(['facts', 'language', 'month']);
    expect(body.month).toBe('2026-10');
    expect(body.language).toBe('en');
    expect(body.facts.length).toBeGreaterThan(0);
    // Each fact is a sentence the card is showing: the model is given nothing the person cannot see.
    for (const fact of body.facts) expect(screen.getByText(fact)).toBeTruthy();
  });

  it('shows the recap, says it was written by AI, and offers to write it again', async () => {
    await mountSummary();

    await pressOn(RECAP_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.getByText(RECAP)).toBeTruthy());
    expect(screen.getByText(COPY.summary.recap.byAi)).toBeTruthy();
    expect(screen.getByLabelText(COPY.summary.recap.again)).toBeTruthy();
    expect(screen.queryByTestId(RECAP_BUTTON_TEST_ID)).toBeNull();
  });

  it('writes it again on request, which asks the server again', async () => {
    const { requests } = await mountSummary();
    await pressOn(RECAP_BUTTON_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByLabelText(COPY.summary.recap.again));

    await waitFor(() => expect(recapRequests(requests)).toHaveLength(2));
  });

  it('shows Fill-style progress while waiting, and ignores a second press', async () => {
    let release: (response: TransportResponse) => void = () => undefined;
    const pending = new Promise<TransportResponse>((resolve) => (release = resolve));
    const { requests } = await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedMonths,
      transport: async () => pending,
    });
    await waitFor(() => expect(screen.queryByTestId(INSIGHTS_TEST_ID)).not.toBeNull());

    await pressOn(RECAP_BUTTON_TEST_ID);
    await userEvent.press(screen.getByTestId(RECAP_BUTTON_TEST_ID));

    expect(screen.getByTestId(RECAP_BUTTON_TEST_ID).props.accessibilityState).toMatchObject({
      busy: true,
    });
    expect(recapRequests(requests)).toHaveLength(1);
    release(ok(200, { data: { text: RECAP } }));
    await waitFor(() => expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).not.toBeNull());
  });
});

describe('a recap is kept for the session, in memory', () => {
  it('comes back with the month, without asking the server again', async () => {
    const { requests } = await mountSummary();
    await pressOn(RECAP_BUTTON_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).not.toBeNull());

    await pressOn(MONTH_PREVIOUS_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).toBeNull());
    await pressOn(MONTH_NEXT_TEST_ID);

    await waitFor(() => expect(screen.getByText(RECAP)).toBeTruthy());
    expect(recapRequests(requests)).toHaveLength(1);
  });

  it('is written for the month in view: another month asks about its own sentences', async () => {
    const { requests } = await mountSummary();
    await pressOn(MONTH_PREVIOUS_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId(RECAP_BUTTON_TEST_ID)).not.toBeNull());

    await pressOn(RECAP_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).not.toBeNull());
    const [request] = recapRequests(requests);
    expect((request as { body: { month: string } }).body.month).toBe('2026-09');
  });

  it('drops an answer that arrives after the month was changed', async () => {
    let release: (response: TransportResponse) => void = () => undefined;
    const pending = new Promise<TransportResponse>((resolve) => (release = resolve));
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedMonths,
      transport: async () => pending,
    });
    await waitFor(() => expect(screen.queryByTestId(INSIGHTS_TEST_ID)).not.toBeNull());
    await pressOn(RECAP_BUTTON_TEST_ID);

    await pressOn(MONTH_PREVIOUS_TEST_ID);
    release(ok(200, { data: { text: RECAP } }));

    await waitFor(() =>
      expect(screen.getByTestId(RECAP_BUTTON_TEST_ID).props.accessibilityState.busy).toBe(false),
    );
    expect(screen.queryByText(RECAP)).toBeNull();
  });
});

describe('when it does not work', () => {
  it('says so in a snackbar and leaves the card as it was, when the server fails', async () => {
    await mountSummary(apiError(502, 'recap_failed'));

    await pressOn(RECAP_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.getByText(COPY.summary.recap.failed)).toBeTruthy());
    expect(screen.queryByTestId(RECAP_TEXT_TEST_ID)).toBeNull();
    expect(screen.getByTestId(RECAP_BUTTON_TEST_ID)).toBeTruthy();
    expect(screen.getByTestId(INSIGHTS_TEST_ID)).toBeTruthy();
  });

  it('says so in a snackbar when the network is down', async () => {
    await mountScreen(<SummaryScreen />, {
      clock: () => NOW,
      seed: seedMonths,
      transport: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await waitFor(() => expect(screen.queryByTestId(INSIGHTS_TEST_ID)).not.toBeNull());

    await pressOn(RECAP_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.getByText(COPY.summary.recap.failed)).toBeTruthy());
  });

  it('takes the button away for the session once the server says it is not set up', async () => {
    await mountSummary(apiError(503, 'recap_unavailable'));

    await pressOn(RECAP_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(RECAP_BUTTON_TEST_ID)).toBeNull());
    expect(screen.queryByText(COPY.summary.recap.hint)).toBeNull();
    // The card itself is untouched: it never depended on the recap.
    expect(screen.getByTestId(INSIGHTS_TEST_ID)).toBeTruthy();
  });

  it('keeps the button away on the next visit to the screen, until the app restarts', async () => {
    await mountSummary(apiError(503, 'recap_unavailable'));
    await pressOn(RECAP_BUTTON_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId(RECAP_BUTTON_TEST_ID)).toBeNull());
    await pressOn(MONTH_PREVIOUS_TEST_ID);
    await pressOn(MONTH_NEXT_TEST_ID);

    expect(screen.queryByTestId(RECAP_BUTTON_TEST_ID)).toBeNull();
  });

  it('is disabled with its reason while the device is offline, and sends nothing', async () => {
    const { requests } = await mountSummary(ok(200, { data: { text: RECAP } }), {
      reachability: createMemoryReachability(false),
    });

    expect(screen.getByText(COPY.summary.recap.offline)).toBeTruthy();
    expect(screen.getByTestId(RECAP_BUTTON_TEST_ID).props.accessibilityState.disabled).toBe(true);
    await userEvent.press(screen.getByTestId(RECAP_BUTTON_TEST_ID));
    expect(recapRequests(requests)).toEqual([]);
  });
});
