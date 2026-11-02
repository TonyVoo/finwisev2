import { screen, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { META_KEYS, readMeta, writeMeta } from '@/db/meta';
import { readUserCurrency, writeUser } from '@/db/user';
import { applyLocalMutation } from '@/db/write';
import type { SqliteDatabase } from '@/db/sqlite';
import { CURRENCY_OPTION_TEST_ID_PREFIX } from '@/expenses/CurrencySheet';
import ChangeCurrencyScreen, {
  CURRENCY_DIALOG_TEST_ID,
  CURRENCY_EXAMPLE_TEST_ID,
  CURRENCY_PASSWORD_TEST_ID,
  CURRENCY_PICK_TEST_ID,
  CURRENCY_RATE_TEST_ID,
  CURRENCY_SUBMIT_TEST_ID,
} from '../../app/(app)/settings/currency';
import { resetRouter, routerRecord } from '../support/router';
import { apiError, mountScreen, ok, pressOn, typeInto } from '../support/mount';
import { categoryId, seedCategory, seedExpense, seedFallbackCategory } from '../support/seed';

jest.mock('expo-router');

const ME = '0192f5a0-0000-7000-8000-00000000a001';
const USER = {
  id: ME,
  email: 'ana@example.com',
  currency: 'USD',
  createdAt: '2026-10-01T00:00:00.000Z',
};

interface Server {
  readonly transport: (request: TransportRequest) => Promise<TransportResponse>;
  readonly calls: string[];
}

function server(options: { rate?: TransportResponse; change?: TransportResponse } = {}): Server {
  const calls: string[] = [];
  const transport = async (request: TransportRequest): Promise<TransportResponse> => {
    const key = `${request.method.toUpperCase()} ${request.path}`;
    calls.push(key);
    switch (key) {
      case 'GET /v1/rates':
        return options.rate ?? apiError(502, 'rate_unavailable');
      case 'POST /v1/me/currency':
        return options.change ?? ok(200, { user: { ...USER, currency: 'VND' } });
      case 'GET /v1/me':
        return ok(200, {
          user: { ...USER, currency: 'VND' },
          dataOwnerId: ME,
          spaces: [{ id: ME, kind: 'personal', name: null, currency: 'VND' }],
        });
      case 'GET /v1/sync':
        return ok(200, { changes: [], nextCursor: 0, hasMore: false });
      default:
        throw new Error(`unexpected request ${key}`);
    }
  };
  return { transport, calls };
}

async function seed(database: SqliteDatabase): Promise<void> {
  await writeUser(database, USER);
  await seedFallbackCategory(database);
  await seedCategory(database, { id: categoryId(1), name: 'Groceries', color: '#2F8044' });
  await seedExpense(database, {
    id: '0192f5a0-0000-7000-8000-0000000000e1',
    categoryId: categoryId(1),
    amountMinor: 1250,
    date: '2026-10-05',
  });
  await writeMeta(database, META_KEYS.dataScope, ME);
}

async function pickVnd(): Promise<void> {
  await pressOn(CURRENCY_PICK_TEST_ID);
  await pressOn(`${CURRENCY_OPTION_TEST_ID_PREFIX}-VND`);
}

beforeEach(() => resetRouter());

describe('changing the currency', () => {
  it('needs a currency, a rate and the password before it asks anything', async () => {
    const s = server();
    await mountScreen(<ChangeCurrencyScreen />, { transport: s.transport, seed });

    await pressOn(CURRENCY_SUBMIT_TEST_ID);

    expect(screen.queryByTestId(CURRENCY_DIALOG_TEST_ID)).toBeNull();
    expect(s.calls).not.toContain('POST /v1/me/currency');
  });

  it('asks for the rate by hand when the market has none for the pair, and previews the effect', async () => {
    const s = server();
    await mountScreen(<ChangeCurrencyScreen />, { transport: s.transport, seed });

    await pickVnd();
    await waitFor(() => expect(screen.queryByText(COPY.currencyChange.rateManual)).not.toBeNull());
    await typeInto(CURRENCY_RATE_TEST_ID, '25400');

    expect(screen.getByTestId(CURRENCY_EXAMPLE_TEST_ID).props.children.join('')).toContain(
      '254,000',
    );
  });

  it('fills in the market rate when there is one', async () => {
    const s = server({
      rate: ok(200, { data: { from: 'USD', to: 'VND', date: '2026-10-05', rate: '25400' } }),
    });
    await mountScreen(<ChangeCurrencyScreen />, { transport: s.transport, seed });

    await pickVnd();

    await waitFor(() =>
      expect(screen.getByTestId(CURRENCY_RATE_TEST_ID).props.value).toBe('25400'),
    );
    expect(screen.getByText(COPY.currencyChange.rateFilled)).toBeTruthy();
  });

  it('confirms first, then converts on the server, clears the old copy and syncs again', async () => {
    const s = server();
    const { database } = await mountScreen(<ChangeCurrencyScreen />, {
      transport: s.transport,
      seed,
    });
    await pickVnd();
    await waitFor(() => expect(screen.queryByText(COPY.currencyChange.rateManual)).not.toBeNull());
    await typeInto(CURRENCY_RATE_TEST_ID, '25400');
    await typeInto(CURRENCY_PASSWORD_TEST_ID, 'correct-horse-battery');

    await pressOn(CURRENCY_SUBMIT_TEST_ID);
    expect(screen.getByTestId(CURRENCY_DIALOG_TEST_ID)).toBeTruthy();
    expect(s.calls).not.toContain('POST /v1/me/currency');
    await pressOn(`${CURRENCY_DIALOG_TEST_ID}-confirm`);

    await waitFor(() => expect(s.calls).toContain('POST /v1/me/currency'));
    await waitFor(() => expect(routerRecord.back).toBeGreaterThan(0));
    // The old-currency rows are gone (the sync brings the converted ones), the account is now in dong.
    const rows = await database.getAllAsync('SELECT id FROM expenses', []);
    expect(rows).toEqual([]);
    expect(await readUserCurrency(database)).toBe('VND');
    expect(await readMeta(database, META_KEYS.dataScope)).toBe(ME);
  });

  it('is a wrong password on the field, and changes nothing here', async () => {
    const s = server({ change: apiError(403, 'forbidden') });
    const { database } = await mountScreen(<ChangeCurrencyScreen />, {
      transport: s.transport,
      seed,
    });
    await pickVnd();
    await waitFor(() => expect(screen.queryByText(COPY.currencyChange.rateManual)).not.toBeNull());
    await typeInto(CURRENCY_RATE_TEST_ID, '25400');
    await typeInto(CURRENCY_PASSWORD_TEST_ID, 'nope');
    await pressOn(CURRENCY_SUBMIT_TEST_ID);
    await pressOn(`${CURRENCY_DIALOG_TEST_ID}-confirm`);

    await waitFor(() => expect(screen.queryByText(COPY.account.wrongPassword)).not.toBeNull());
    expect((await database.getAllAsync('SELECT id FROM expenses', [])).length).toBe(1);
    expect(await readUserCurrency(database)).toBe('USD');
  });

  it('will not convert while changes are waiting to sync', async () => {
    const s = server();
    const { database } = await mountScreen(<ChangeCurrencyScreen />, {
      transport: s.transport,
      seed,
    });
    await applyLocalMutation(
      database,
      {
        entity: 'category',
        id: '0192f5a0-0000-7000-8000-0000000000c9',
        fields: { name: 'Pets', color: '#2F8044' },
      },
      { clock: () => new Date('2026-10-26T09:00:00.000Z') },
    );
    await pickVnd();
    await waitFor(() => expect(screen.queryByText(COPY.currencyChange.rateManual)).not.toBeNull());
    await typeInto(CURRENCY_RATE_TEST_ID, '25400');
    await typeInto(CURRENCY_PASSWORD_TEST_ID, 'correct-horse-battery');
    await pressOn(CURRENCY_SUBMIT_TEST_ID);
    await pressOn(`${CURRENCY_DIALOG_TEST_ID}-confirm`);

    await waitFor(() => expect(screen.queryByText(COPY.currencyChange.syncFirst)).not.toBeNull());
    expect(s.calls).not.toContain('POST /v1/me/currency');
  });
});
