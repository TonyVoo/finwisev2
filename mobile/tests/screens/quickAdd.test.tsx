import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { resetQuickAddAvailabilityForTests } from '@/quickAdd/quickAddAvailability';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID } from '@/expenses/AmountDisplay';
import {
  CATEGORY_ROW_TEST_ID,
  DATE_ROW_TEST_ID,
  NOTE_ROW_TEST_ID,
  SAVE_TEST_ID,
} from '@/expenses/ExpenseFormScreen';
import { dateRowLabel } from '@/lib/calendar';
import {
  QUICK_ADD_FILL_TEST_ID,
  QUICK_ADD_INPUT_TEST_ID,
  QUICK_ADD_SUGGESTION_DISMISS_TEST_ID,
  QUICK_ADD_SUGGESTION_TEST_ID,
  QUICK_ADD_SUGGESTION_USE_TEST_ID,
} from '@/quickAdd/QuickAddLine';
import NewExpenseScreen from '../../app/(app)/expense/new';
import EditExpenseScreen from '../../app/(app)/expense/[id]';
import { resetRouter, setSearchParams } from '../support/router';
import { apiError, mountScreen, ok, type MountedScreen } from '../support/mount';
import {
  categoryId,
  expenseId,
  outboxEntries,
  seedCategory,
  seedExpense,
  seedFallbackCategory,
} from '../support/seed';

jest.mock('expo-router');

/**
 * Quick add on the expense form (`docs/design/15-quick-add.md`): a "Describe it" line above the form.
 * Fill reads the sentence on the phone and offers a suggestion; nothing reaches a field until Use,
 * nothing is saved until Save, and the network is never touched (every request fails the test).
 */

const NOW = new Date(2026, 9, 14, 9, 0, 0);
const today = () => '2026-10-14';
const yesterday = () => '2026-10-13';
const GROCERIES = categoryId(1);
const EATING_OUT = categoryId(2);

async function seedBasics(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
  await seedCategory(database, { id: EATING_OUT, name: 'Eating out', color: '#C45A1A' });
}

async function noNetwork(request: TransportRequest): Promise<TransportResponse> {
  throw new Error(`unexpected request ${request.method} ${request.path}`);
}

async function mountAdd(): Promise<MountedScreen> {
  const mounted = await mountScreen(<NewExpenseScreen />, {
    clock: () => NOW,
    seed: seedBasics,
    transport: noNetwork,
  });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  return mounted;
}

async function typeAndFill(text: string) {
  await userEvent.type(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), text);
  await userEvent.press(screen.getByTestId(QUICK_ADD_FILL_TEST_ID));
}

const label = (testID: string) =>
  screen.getByTestId(testID, { includeHiddenElements: true }).props.accessibilityLabel as string;

beforeEach(() => {
  resetRouter();
  resetQuickAddAvailabilityForTests();
});

describe('the Describe it line', () => {
  it('is on Add expense, starts empty, and says what it reads once it is used', async () => {
    await mountAdd();

    expect(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID).props.value).toBe('');
    expect(screen.getByPlaceholderText(COPY.form.quickAdd.placeholder)).toBeTruthy();
    // Not above every form: the line about where the sentence is read shows when the field is used.
    expect(screen.queryByText(COPY.form.quickAdd.hint)).toBeNull();
    await act(async () => {
      fireEvent(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), 'focus');
    });
    expect(screen.getByText(COPY.form.quickAdd.hint)).toBeTruthy();
    expect(COPY.form.quickAdd.hint).toMatch(/outside service/);
    expect(screen.getByLabelText(COPY.form.quickAdd.fill)).toBeTruthy();
  });

  it('is not there when editing an existing expense', async () => {
    setSearchParams({ id: expenseId(1) });
    await mountScreen(<EditExpenseScreen />, {
      clock: () => NOW,
      seed: async (database) => {
        await seedBasics(database);
        await seedExpense(database, {
          id: expenseId(1),
          categoryId: GROCERIES,
          amountMinor: 500,
          date: '2026-10-13',
        });
      },
      transport: noNetwork,
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

    expect(screen.queryByTestId(QUICK_ADD_INPUT_TEST_ID)).toBeNull();
  });
});

describe('Fill', () => {
  it('shows a suggestion card and changes no field', async () => {
    const { requests } = await mountAdd();

    await typeAndFill('coffee 4.50 yesterday');

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(screen.getByText(COPY.form.quickAdd.suggestionTitle)).toBeTruthy();
    expect(screen.getByText(/\$4\.50 · .* · Coffee/)).toBeTruthy();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
    expect(label(NOTE_ROW_TEST_ID)).not.toContain('Coffee');
    expect(requests).toEqual([]);
  });

  it('fills the fields on Use, empties the line, and still saves nothing until Save', async () => {
    const { database } = await mountAdd();
    await typeAndFill('coffee 4.50 yesterday');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('4.50');
    expect(label(DATE_ROW_TEST_ID)).toContain(dateRowLabel('2026-10-13', '2026-10-14'));
    expect(label(NOTE_ROW_TEST_ID)).toContain('Coffee');
    expect(label(CATEGORY_ROW_TEST_ID)).toContain('Eating out');
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
    expect(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID).props.value).toBe('');
    expect(await outboxEntries(database)).toEqual([]);
  });

  it('saves what was used, as an ordinary expense', async () => {
    const { database } = await mountAdd();
    await typeAndFill('coffee 4.50 yesterday');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));

    await waitFor(async () =>
      expect((await outboxEntries(database)).some((entry) => entry.entity === 'expense')).toBe(
        true,
      ),
    );
    const entry = (await outboxEntries(database)).find((row) => row.entity === 'expense');
    expect(JSON.parse(entry?.fields ?? '{}')).toMatchObject({
      kind: 'expense',
      amountMinor: 450,
      date: '2026-10-13',
      note: 'Coffee',
      categoryId: EATING_OUT,
    });
  });

  it('turns the form to income for a salary', async () => {
    await mountAdd();
    await typeAndFill('salary 3000');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(screen.getByTestId('kind-toggle-income').props.accessibilityState.selected).toBe(true);
    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('3,000.00');
  });

  it('leaves every field alone on Dismiss, keeping what was typed', async () => {
    await mountAdd();
    await typeAndFill('coffee 4.50');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_DISMISS_TEST_ID));

    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
    expect(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID).props.value).toBe('coffee 4.50');
  });

  it('drops the suggestion as soon as the sentence changes, since it no longer describes it', async () => {
    await mountAdd();
    await typeAndFill('coffee 4.50');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.type(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), '0');

    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });

  it('says so, instead of guessing, when it cannot tell the amount, and still offers the rest', async () => {
    await mountAdd();
    await typeAndFill('coffee 4.50 tip 1.00');
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    expect(screen.getByText(new RegExp(COPY.form.quickAdd.noAmount))).toBeTruthy();
    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
    expect(label(CATEGORY_ROW_TEST_ID)).toContain('Eating out');
  });

  it('says it could not read a sentence with nothing in it, and shows no card', async () => {
    await mountAdd();

    await typeAndFill('!!!');

    await waitFor(() => expect(screen.getByText(COPY.form.quickAdd.nothingFound)).toBeTruthy());
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });

  it('asks for a sentence when the line is empty', async () => {
    await mountAdd();

    await userEvent.press(screen.getByTestId(QUICK_ADD_FILL_TEST_ID));

    await waitFor(() => expect(screen.getByText(COPY.form.quickAdd.empty)).toBeTruthy());
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });
});

/**
 * When the phone's own rules are unsure it asks the server (`POST /v1/quick-add`), merges the answer,
 * and carries on quietly however that goes: the person always gets a card made of at least what the
 * phone read itself.
 */
describe('when the rules are unsure', () => {
  const UNSURE = 'coffee 4.50 tip 1.00';
  const FOUND = {
    type: 'expense',
    amountMinor: 450,
    currency: 'USD',
    date: yesterday(),
    note: 'coffee',
    category: 'groceries',
  };

  function quickAddReturns(response: TransportResponse) {
    return async (request: TransportRequest): Promise<TransportResponse> => {
      if (request.method === 'post' && request.path === '/v1/quick-add') return response;
      throw new Error(`unexpected request ${request.method} ${request.path}`);
    };
  }

  async function mountAsking(response: TransportResponse): Promise<MountedScreen> {
    const mounted = await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: seedBasics,
      transport: quickAddReturns(response),
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
    return mounted;
  }

  it('sends nothing for a sentence the phone is sure of', async () => {
    const { requests } = await mountAsking(ok(200, { data: FOUND }));

    await typeAndFill('coffee 4.50 yesterday');

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(requests).toEqual([]);
  });

  it('asks the server, sending the sentence and the date and nothing else', async () => {
    const { requests } = await mountAsking(ok(200, { data: FOUND }));

    await typeAndFill(UNSURE);

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'post',
      path: '/v1/quick-add',
      body: { text: UNSURE, today: '2026-10-14' },
    });
    expect(Object.keys((requests[0] as { body: object }).body).sort()).toEqual(['text', 'today']);
  });

  it('shows the amount the server found, kept beside what the phone read, changing no field', async () => {
    await mountAsking(ok(200, { data: FOUND }));

    await typeAndFill(UNSURE);

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(screen.getByText(/\$4\.50 · .* · Coffee/)).toBeTruthy();
    expect(label(AMOUNT_DISPLAY_TEST_ID)).not.toContain('4.50');
  });

  it("fills the form with the merge on Use: the phone's category wins, the model fills the amount and date", async () => {
    await mountAsking(ok(200, { data: FOUND }));
    await typeAndFill(UNSURE);
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());

    await userEvent.press(screen.getByTestId(QUICK_ADD_SUGGESTION_USE_TEST_ID));

    expect(label(AMOUNT_DISPLAY_TEST_ID)).toContain('4.50');
    expect(label(DATE_ROW_TEST_ID)).toContain(dateRowLabel(yesterday(), today()));
    expect(label(NOTE_ROW_TEST_ID)).toContain('Coffee');
    // The phone matched "coffee" to Eating out; the model said groceries, and does not overrule it.
    expect(label(CATEGORY_ROW_TEST_ID)).toContain('Eating out');
  });

  it('shows what the phone read when the server fails, with no error', async () => {
    await mountAsking(apiError(502, 'quick_add_failed'));

    await typeAndFill(UNSURE);

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(screen.getByText(new RegExp(COPY.form.quickAdd.noAmount))).toBeTruthy();
    expect(screen.queryByText(COPY.form.quickAdd.nothingFound)).toBeNull();
  });

  it('shows what the phone read when the network is down', async () => {
    await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: seedBasics,
      transport: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

    await typeAndFill(UNSURE);

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(screen.getByText(new RegExp(COPY.form.quickAdd.noAmount))).toBeTruthy();
  });

  it('stops asking for the session once the server says it is not set up, and says so in the hint', async () => {
    const { requests } = await mountAsking(apiError(503, 'quick_add_unavailable'));

    await typeAndFill(UNSURE);
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(screen.getByText(COPY.form.quickAdd.hintLocal)).toBeTruthy();
    expect(screen.queryByText(COPY.form.quickAdd.hint)).toBeNull();

    await userEvent.type(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), ' and more');
    await userEvent.press(screen.getByTestId(QUICK_ADD_FILL_TEST_ID));

    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
    expect(requests).toHaveLength(1);
  });

  it('shows Fill as busy while waiting, and ignores a second press', async () => {
    let release: (response: TransportResponse) => void = () => undefined;
    const pending = new Promise<TransportResponse>((resolve) => (release = resolve));
    const { requests } = await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: seedBasics,
      transport: async () => pending,
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());

    await typeAndFill(UNSURE);
    await userEvent.press(screen.getByTestId(QUICK_ADD_FILL_TEST_ID));

    expect(screen.getByTestId(QUICK_ADD_FILL_TEST_ID).props.accessibilityState).toMatchObject({
      busy: true,
    });
    expect(requests).toHaveLength(1);
    release(ok(200, { data: FOUND }));
    await waitFor(() => expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).not.toBeNull());
  });

  it('drops the answer if the sentence changed while it was on its way', async () => {
    let release: (response: TransportResponse) => void = () => undefined;
    const pending = new Promise<TransportResponse>((resolve) => (release = resolve));
    await mountScreen(<NewExpenseScreen />, {
      clock: () => NOW,
      seed: seedBasics,
      transport: async () => pending,
    });
    await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
    await typeAndFill(UNSURE);

    await userEvent.type(screen.getByTestId(QUICK_ADD_INPUT_TEST_ID), '0');
    release(ok(200, { data: FOUND }));

    await waitFor(() =>
      expect(screen.getByTestId(QUICK_ADD_FILL_TEST_ID).props.accessibilityState.busy).toBe(false),
    );
    expect(screen.queryByTestId(QUICK_ADD_SUGGESTION_TEST_ID)).toBeNull();
  });
});
