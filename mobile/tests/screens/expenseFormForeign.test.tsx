import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import type { SqliteDatabase } from '@/db/sqlite';
import { AMOUNT_DISPLAY_TEST_ID, AMOUNT_MESSAGE_TEST_ID } from '@/expenses/AmountDisplay';
import { CURRENCY_OPTION_TEST_ID_PREFIX } from '@/expenses/CurrencySheet';
import {
  CONVERTED_TEST_ID,
  CURRENCY_ROW_TEST_ID,
  RATE_FIELD_TEST_ID,
  SAVE_TEST_ID,
} from '@/expenses/ExpenseFormScreen';
import { RATE_DONE_TEST_ID, RATE_INPUT_TEST_ID } from '@/expenses/RateSheet';
import NewExpenseScreen from '../../app/(app)/expense/new';
import { resetRouter } from '../support/router';
import { apiError, mountScreen, type MountedScreen } from '../support/mount';
import type { Transport } from '@/api/transport';
import { entryAt, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

/**
 * Paying in another currency, through the real form: pick a currency, see the rate, type the
 * amount in that currency, and save the converted amount beside the original.
 *
 * The rate lookup is the only thing here that touches the network, and the form must work
 * without it: every case below that loses it still ends with a saved expense.
 */

const NOW = new Date('2026-10-14T10:00:00.000Z');
const GROCERIES = '0192f5a0-0000-7000-8000-000000000002';

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: GROCERIES, name: 'Groceries', color: '#2F8044' });
}

const RATE_OK: Transport = async (request) => {
  if (request.path === '/v1/rates') {
    return {
      status: 200,
      body: { data: { from: 'EUR', to: 'USD', date: '2026-10-14', rate: '1.0823' } },
      requestId: 'req-test',
    };
  }
  throw new Error(`unexpected request ${request.method} ${request.path}`);
};

async function mountWith(transport: Transport): Promise<MountedScreen> {
  const mounted = await mountScreen(<NewExpenseScreen />, { clock: () => NOW, seed, transport });
  await waitFor(() => expect(screen.queryByTestId(AMOUNT_DISPLAY_TEST_ID)).not.toBeNull());
  return mounted;
}

async function pickCurrency(code: string): Promise<void> {
  await userEvent.press(screen.getByTestId(CURRENCY_ROW_TEST_ID));
  await userEvent.press(screen.getByTestId(`${CURRENCY_OPTION_TEST_ID_PREFIX}-${code}`));
}

async function typeAmount(keys: string): Promise<void> {
  for (const key of keys) await userEvent.press(screen.getByTestId(`keypad-${key}`));
}

const displayed = () => screen.getByTestId(AMOUNT_DISPLAY_TEST_ID).props.children as string;

beforeEach(() => resetRouter());

describe('paying in another currency', () => {
  it('starts in the account currency, with no rate row', async () => {
    await mountWith(RATE_OK);
    expect(screen.queryByTestId(RATE_FIELD_TEST_ID)).toBeNull();
    expect(displayed()).toBe('$0.00');
  });

  it('looks the rate up, converts what is typed, and saves both amounts', async () => {
    const { database, requests } = await mountWith(RATE_OK);

    await pickCurrency('EUR');
    await waitFor(() => expect(screen.getByTestId(RATE_FIELD_TEST_ID)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('1.0823')).toBeTruthy());
    expect(requests.map((r) => r.path)).toEqual(['/v1/rates']);

    await typeAmount('1000');
    // The keypad is now in euros.
    expect(displayed()).toContain('€');
    expect(screen.getByTestId(CONVERTED_TEST_ID).props.children).toBe('= $10.82');

    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));
    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));

    const row = await database.getFirstAsync<{
      id: string;
      amountMinor: number;
      currency: string;
      originalAmountMinor: number;
      originalCurrency: string;
    }>('SELECT id, amountMinor, currency, originalAmountMinor, originalCurrency FROM expenses', []);
    // `amountMinor` is the account-currency amount every total sums; the original sits beside it.
    expect(row).toMatchObject({
      amountMinor: 1082,
      currency: 'USD',
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
    expect(JSON.parse(entryAt(await outboxEntries(database), 0).fields)).toMatchObject({
      amountMinor: 1082,
      originalAmountMinor: 1000,
      originalCurrency: 'EUR',
    });
  });

  it('asks for the rate for the day chosen, not just today', async () => {
    const { requests } = await mountWith(RATE_OK);
    await pickCurrency('EUR');
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.stringify(requests[0])).toContain('EUR');
    expect(JSON.stringify(requests[0])).toContain('2026-10-14');
  });

  it('switching back to the account currency saves an ordinary expense', async () => {
    const { database } = await mountWith(RATE_OK);
    await pickCurrency('EUR');
    await pickCurrency('USD');
    expect(screen.queryByTestId(RATE_FIELD_TEST_ID)).toBeNull();

    await typeAmount('500');
    await userEvent.press(screen.getByTestId(SAVE_TEST_ID));
    await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));

    const row = await database.getFirstAsync<{
      amountMinor: number;
      originalAmountMinor: number | null;
      originalCurrency: string | null;
    }>('SELECT amountMinor, originalAmountMinor, originalCurrency FROM expenses', []);
    expect(row).toEqual({ amountMinor: 500, originalAmountMinor: null, originalCurrency: null });
  });

  it('clears the typed digits when the new currency has a different minor unit', async () => {
    await mountWith(RATE_OK);
    await typeAmount('1000');
    expect(displayed()).toBe('$10.00');

    await pickCurrency('JPY');
    // 1000 yen is not ten dollars: the digits mean something else, so they are cleared.
    expect(displayed()).toContain('0');
    expect(displayed()).not.toContain('1,000');
  });

  describe('without a rate', () => {
    const offline: Transport = async () => {
      throw new Error('offline');
    };
    const down: Transport = async () => apiError(502, 'rates_unavailable');

    it.each([
      ['offline', offline],
      ['the provider is down', down],
    ])('says so and lets you enter one yourself when %s', async (_name, transport) => {
      const { database } = await mountWith(transport);
      await pickCurrency('EUR');
      await waitFor(() => expect(screen.getByText(COPY.form.rate.failed)).toBeTruthy());

      await typeAmount('1000');
      // Save explains itself rather than staying silently disabled.
      expect(screen.getByTestId(AMOUNT_MESSAGE_TEST_ID).props.children).toBe(COPY.form.rate.needed);
      expect(screen.getByTestId(SAVE_TEST_ID).props.accessibilityState.disabled).toBe(true);

      await userEvent.press(screen.getByTestId(RATE_FIELD_TEST_ID));
      await userEvent.type(screen.getByTestId(RATE_INPUT_TEST_ID), '1,1');
      await userEvent.press(screen.getByTestId(RATE_DONE_TEST_ID));

      expect(screen.getByTestId(CONVERTED_TEST_ID).props.children).toBe('= $11.00');
      await userEvent.press(screen.getByTestId(SAVE_TEST_ID));
      await waitFor(async () => expect(await outboxEntries(database)).toHaveLength(1));
      const row = await database.getFirstAsync<{ amountMinor: number }>(
        'SELECT amountMinor FROM expenses',
        [],
      );
      expect(row?.amountMinor).toBe(1100);
    });

    it('refuses a rate that is not a positive decimal, with the reason', async () => {
      await mountWith(offline);
      await pickCurrency('EUR');
      await waitFor(() => expect(screen.getByText(COPY.form.rate.failed)).toBeTruthy());
      await userEvent.press(screen.getByTestId(RATE_FIELD_TEST_ID));
      await userEvent.type(screen.getByTestId(RATE_INPUT_TEST_ID), '0');
      await userEvent.press(screen.getByTestId(RATE_DONE_TEST_ID));

      expect(screen.getByText(COPY.form.rate.invalid)).toBeTruthy();
    });
  });

  it('keeps a rate the person typed, instead of replacing it with a fetched one', async () => {
    let calls = 0;
    const slow: Transport = async (request) => {
      calls += 1;
      return RATE_OK(request);
    };
    await mountWith(slow);
    await pickCurrency('EUR');
    await waitFor(() => expect(screen.getByText('1.0823')).toBeTruthy());

    await userEvent.press(screen.getByTestId(RATE_FIELD_TEST_ID));
    const input = screen.getByTestId(RATE_INPUT_TEST_ID);
    await userEvent.clear(input);
    await userEvent.type(input, '1.2');
    await userEvent.press(screen.getByTestId(RATE_DONE_TEST_ID));
    await act(async () => undefined);

    expect(screen.getByText('1.2')).toBeTruthy();
    expect(calls).toBe(1);
  });
});
