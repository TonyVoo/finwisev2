import { screen, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { createTrade } from '@/db/mutations';
import { writeUser } from '@/db/user';
import {
  PLAN_AMOUNT_TEST_ID,
  PLAN_DAY_TEST_ID,
  PLAN_PREVIEW_TEST_ID,
  PLAN_RECORD_TEST_ID,
  PLAN_SAVE_TEST_ID,
  PLAN_SYMBOL_TEST_ID,
} from '@/invest/DcaPlanSheet';
import { readPlans } from '@/invest/dca';
import {
  IMPORT_SUBMIT_TEST_ID,
  IMPORT_SUMMARY_TEST_ID,
  IMPORT_TEXT_TEST_ID,
  IMPORT_UNREADABLE_TEST_ID,
} from '@/invest/ImportTradesSheet';
import {
  TRADE_SIDE_DIVIDEND_TEST_ID,
  TRADE_HOLD_TEST_ID,
  TRADE_TODAY_TEST_ID,
  TRADE_TOTAL_TEST_ID,
  TRADE_YESTERDAY_TEST_ID,
  TRADE_DATE_TEST_ID,
  TRADE_DELETE_TEST_ID,
  TRADE_FEE_TEST_ID,
  TRADE_PRICE_TEST_ID,
  TRADE_QUANTITY_TEST_ID,
  TRADE_SIDE_SELL_TEST_ID,
  TRADE_SUBMIT_TEST_ID,
  TRADE_SYMBOL_TEST_ID,
} from '@/invest/TradeFormSheet';
import PortfolioScreen, { PORTFOLIO_ROW_PREFIX, TRADE_ROW_PREFIX } from '../../app/(app)/portfolio';
import { apiError, mountScreen, ok, pressOn, typeInto, type MountedScreen } from '../support/mount';
import { resetRouter } from '../support/router';

jest.mock('expo-router');

/**
 * The portfolio screen: trades go in through a sheet and are written to the local store and queued; the
 * holdings and profit are worked out from them; prices come from the server and a missing one is shown
 * as missing, never as a loss.
 */

const NOW = new Date(2026, 10, 6, 9, 0, 0);

function quote(symbol: string, close: number) {
  return {
    data: {
      symbol,
      source: 'vnstock',
      demo: false,
      asOf: '2026-11-06',
      close,
      prevClose: close,
      changePct: 0,
      high52w: close,
      low52w: close,
      series: [{ date: '2026-11-06', close, volume: 1 }],
    },
  };
}

function market(closes: Record<string, number | 'down'>) {
  return async (request: TransportRequest): Promise<TransportResponse> => {
    const match = /^\/v1\/market\/quotes\/(\w+)$/.exec(request.path);
    if (match?.[1] !== undefined) {
      const close = closes[match[1]];
      if (close === undefined || close === 'down') return apiError(503, 'market_unavailable');
      return ok(200, quote(match[1], close));
    }
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  };
}

async function mountPortfolio(
  closes: Record<string, number | 'down'> = { VNM: 56870 },
  seed?: (database: MountedScreen['database']) => Promise<void>,
): Promise<MountedScreen> {
  return mountScreen(<PortfolioScreen />, {
    clock: () => NOW,
    transport: market(closes),
    seed: async (database) => {
      await writeUser(database, {
        id: '0192f5a0-0000-7000-8000-00000000a001',
        email: 'ada@example.com',
        currency: 'USD',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      await seed?.(database);
    },
  });
}

const buy = (symbol: string, quantity: number, price: number, fee = 0, date = '2026-11-01') => ({
  symbol,
  side: 'buy' as const,
  quantity,
  price,
  fee,
  date,
});

beforeEach(() => resetRouter());

describe('an empty portfolio', () => {
  it('says there is nothing yet, and asks for nothing from the server', async () => {
    const { requests } = await mountPortfolio();

    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());
    expect(screen.getByText(COPY.portfolio.emptyHeadline)).toBeTruthy();
    expect(screen.getByText(COPY.portfolio.private)).toBeTruthy();
    expect(requests).toEqual([]);
  });
});

describe('adding a trade', () => {
  it('writes it locally, queues it, and shows the holding with its profit at the last close', async () => {
    const { database } = await mountPortfolio();
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());

    await pressOn('portfolio-fab');
    await typeInto(TRADE_SYMBOL_TEST_ID, 'vnm');
    await typeInto(TRADE_QUANTITY_TEST_ID, '100');
    await typeInto(TRADE_PRICE_TEST_ID, '50000');
    await typeInto(TRADE_FEE_TEST_ID, '7500');
    await pressOn(TRADE_SUBMIT_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());
    const outbox = await database.getAllAsync<{ entity: string }>('SELECT entity FROM outbox', []);
    expect(outbox.map((row) => row.entity)).toEqual(['trade']);
    // Cost 100 x 50.000 + 7.500; value 100 x 56.870; profit 679.500, which is +13,6% of the cost.
    await waitFor(() => expect(screen.queryByTestId('portfolio-unrealized')).not.toBeNull());
    expect(screen.getByTestId('portfolio-unrealized-pill').props.accessibilityLabel).toBe('+13.6%');
    expect(String(screen.getByTestId('portfolio-unrealized').props.children)).toMatch(/679[.,]500/);
  });

  it('keeps the sheet open and says what is wrong when the form is incomplete', async () => {
    const { database } = await mountPortfolio();
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());

    await pressOn('portfolio-fab');
    await pressOn(TRADE_SUBMIT_TEST_ID);

    expect(screen.getByText(COPY.portfolio.symbolError)).toBeTruthy();
    expect(screen.getByText(COPY.portfolio.quantityError)).toBeTruthy();
    expect(screen.getByText(COPY.portfolio.priceError)).toBeTruthy();
    expect(await database.getAllAsync('SELECT * FROM outbox', [])).toEqual([]);
  });
});

describe('with trades', () => {
  const seeded = async (database: MountedScreen['database']) => {
    await createTrade(database, buy('VNM', 100, 50000, 0));
    await createTrade(database, buy('ZZZ', 100, 10000, 0));
  };

  it('values what has a price and says plainly what has none', async () => {
    await mountPortfolio({ VNM: 56870, ZZZ: 'down' }, seeded);

    await waitFor(() => expect(screen.queryByTestId('portfolio-unpriced')).not.toBeNull());
    expect(screen.getByText(COPY.portfolio.unpricedOne)).toBeTruthy();
    // The unpriced holding is not counted as a loss: the profit is the priced one's alone.
    expect(screen.getByTestId('portfolio-unrealized-pill').props.accessibilityLabel).toBe('+13.7%');
  });

  it('says prices are unavailable, and shows no profit, when none can be had', async () => {
    await mountPortfolio({ VNM: 'down', ZZZ: 'down' }, seeded);

    await waitFor(() =>
      expect(screen.queryByText(COPY.portfolio.pricesUnavailable)).not.toBeNull(),
    );
    expect(screen.queryByTestId('portfolio-unrealized')).toBeNull();
  });

  it('books profit from a sale as realised', async () => {
    const { database } = await mountPortfolio({ VNM: 56870 }, seeded);
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());

    await pressOn('portfolio-fab');
    await pressOn(TRADE_SIDE_SELL_TEST_ID);
    await typeInto(TRADE_SYMBOL_TEST_ID, 'VNM');
    await typeInto(TRADE_QUANTITY_TEST_ID, '100');
    await typeInto(TRADE_PRICE_TEST_ID, '60000');
    await pressOn(TRADE_SUBMIT_TEST_ID);

    await waitFor(() =>
      expect(String(screen.getByTestId('portfolio-realized').props.children)).toMatch(
        /1[.,]000[.,]000/,
      ),
    );
    expect(
      (
        await database.getAllAsync<{ side: string }>(
          'SELECT side FROM trades ORDER BY updatedAt',
          [],
        )
      ).map((r) => r.side),
    ).toContain('sell');
  });

  it('deletes a trade after a confirmation, and the holding goes with it', async () => {
    const { database } = await mountPortfolio({ ZZZ: 56870 }, async (db) => {
      await createTrade(db, buy('ZZZ', 100, 50000));
    });
    const row = await screen.findByTestId(new RegExp(`^${TRADE_ROW_PREFIX}-`));

    await pressOn(row.props.testID as string);
    await pressOn(TRADE_DELETE_TEST_ID);
    await pressOn('portfolio-delete-dialog-confirm');

    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-ZZZ`)).toBeNull());
    const live = await database.getAllAsync('SELECT id FROM trades WHERE deletedAt IS NULL', []);
    expect(live).toEqual([]);
  });
});

describe('the trade sheet', () => {
  const seeded = async (database: MountedScreen['database']) => {
    await createTrade(database, buy('VNM', 1200, 50000, 0));
  };

  it('works out the total, fee included, as the fields are filled', async () => {
    await mountPortfolio({ VNM: 56870 }, seeded);
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());
    await pressOn('portfolio-fab');

    expect(screen.getByTestId(TRADE_TOTAL_TEST_ID)).toHaveTextContent(/—/);
    await typeInto(TRADE_QUANTITY_TEST_ID, '100');
    await typeInto(TRADE_PRICE_TEST_ID, '50000');
    await typeInto(TRADE_FEE_TEST_ID, '7500');

    expect(screen.getByTestId(TRADE_TOTAL_TEST_ID)).toHaveTextContent(/5[.,]007[.,]500/);
    // And groups the thousands in the field itself as they are typed.
    expect(String(screen.getByTestId(TRADE_PRICE_TEST_ID).props.value)).toMatch(/50[.,]000/);
  });

  it('says how many shares are held when selling one that is', async () => {
    await mountPortfolio({ VNM: 56870 }, seeded);
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());
    await pressOn('portfolio-fab');
    await pressOn(TRADE_SIDE_SELL_TEST_ID);
    await typeInto(TRADE_SYMBOL_TEST_ID, 'vnm');

    expect(screen.getByTestId(TRADE_HOLD_TEST_ID)).toHaveTextContent(/1[.,]200/);
  });

  it('offers what is held under the symbol field, and fills it on a tap', async () => {
    await mountPortfolio({ VNM: 56870 }, seeded);
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());
    await pressOn('portfolio-fab');

    await pressOn('trade-suggest-VNM');

    expect(screen.getByTestId(TRADE_SYMBOL_TEST_ID).props.value).toBe('VNM');
  });

  it('sets the date to today or yesterday in one tap', async () => {
    await mountPortfolio({ VNM: 56870 }, seeded);
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());
    await pressOn('portfolio-fab');

    await pressOn(TRADE_YESTERDAY_TEST_ID);
    expect(screen.getByTestId(TRADE_DATE_TEST_ID).props.value).toBe('2026-11-05');
    await pressOn(TRADE_TODAY_TEST_ID);
    expect(screen.getByTestId(TRADE_DATE_TEST_ID).props.value).toBe('2026-11-06');
  });

  it('groups the day of each trade under a heading', async () => {
    await mountPortfolio({ VNM: 56870 }, async (database) => {
      await createTrade(database, buy('VNM', 100, 50000, 0, '2026-11-06'));
      await createTrade(database, buy('VNM', 100, 52000, 0, '2026-11-05'));
    });

    await waitFor(() => expect(screen.queryByText(COPY.home.section.today)).not.toBeNull());
    expect(screen.getByText(COPY.home.section.yesterday)).toBeTruthy();
  });
});

describe('dividends and performance', () => {
  it('records a dividend as income without touching the holding', async () => {
    const { database } = await mountPortfolio({ VNM: 56870 }, async (db) => {
      await createTrade(db, buy('VNM', 100, 50000));
    });
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());

    await pressOn('portfolio-fab');
    await pressOn(TRADE_SIDE_DIVIDEND_TEST_ID);
    await typeInto(TRADE_SYMBOL_TEST_ID, 'VNM');
    await typeInto(TRADE_QUANTITY_TEST_ID, '100');
    await typeInto(TRADE_PRICE_TEST_ID, '2000');
    await typeInto(TRADE_FEE_TEST_ID, '20000');
    expect(screen.getByTestId(TRADE_TOTAL_TEST_ID)).toHaveTextContent(/180[.,]000/);
    await pressOn(TRADE_SUBMIT_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId('portfolio-dividends')).not.toBeNull());
    expect(String(screen.getByTestId('portfolio-dividends').props.children)).toMatch(/180[.,]000/);
    expect(screen.getByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).toBeTruthy();
    const sides = await database.getAllAsync<{ side: string }>(
      'SELECT side FROM trades ORDER BY side',
      [],
    );
    expect(sides.map((row) => row.side)).toEqual(['buy', 'dividend']);
  });

  it('shows the win rate and which #reason paid once something has been sold', async () => {
    await mountPortfolio({}, async (db) => {
      await createTrade(db, { ...buy('AAA', 100, 10000), note: '#breakout' });
      await createTrade(db, {
        ...buy('AAA', 0 + 1, 1),
        side: 'sell',
        quantity: 100,
        price: 12000,
        date: '2026-11-02',
      });
      await createTrade(db, { ...buy('BBB', 100, 10000), note: '#breakout' });
      await createTrade(db, {
        ...buy('BBB', 1, 1),
        side: 'sell',
        quantity: 100,
        price: 9000,
        date: '2026-11-03',
      });
    });

    await waitFor(() => expect(screen.queryByTestId('portfolio-performance')).not.toBeNull());
    expect(String(screen.getByTestId('portfolio-winrate').props.children)).toMatch(/50/);
    expect(screen.getByTestId('portfolio-reason-breakout')).toBeTruthy();
  });
});

describe('importing a statement', () => {
  const STATEMENT = [
    'Ngày GD,Mã CK,Loại lệnh,Khối lượng,Giá khớp,Phí',
    '04/11/2026,VNM,Mua,100,56.8,8520',
    '05/11/2026,FPT,Mua,200,120000,18000',
    'hỏng,FPT,Mua,1,1,0',
  ].join('\n');

  it('previews what will be added and what cannot be read, then adds it through the local write', async () => {
    const { database } = await mountPortfolio({ VNM: 56870, FPT: 120000 });
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());

    await pressOn('portfolio-import');
    await typeInto(IMPORT_TEXT_TEST_ID, STATEMENT);

    const summary = screen.getByTestId(IMPORT_SUMMARY_TEST_ID);
    expect(summary).toHaveTextContent(/2 trades ready/);
    expect(summary).toHaveTextContent(/1 rows could not be read/);
    expect(summary).toHaveTextContent(/Row 4: date not understood/);

    await pressOn(IMPORT_SUBMIT_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());
    expect(screen.getByTestId(`${PORTFOLIO_ROW_PREFIX}-FPT`)).toBeTruthy();
    const outbox = await database.getAllAsync<{ entity: string }>('SELECT entity FROM outbox', []);
    expect(outbox.map((row) => row.entity)).toEqual(['trade', 'trade']);
  });

  it('adds nothing the second time the same statement is read', async () => {
    await mountPortfolio({ VNM: 56870, FPT: 120000 }, async (db) => {
      await createTrade(db, buy('VNM', 100, 56800, 8520, '2026-11-04'));
    });
    await waitFor(() => expect(screen.queryByTestId(`${PORTFOLIO_ROW_PREFIX}-VNM`)).not.toBeNull());

    await pressOn('portfolio-import');
    await typeInto(
      IMPORT_TEXT_TEST_ID,
      'date,symbol,side,quantity,price,fee\n2026-11-04,VNM,buy,100,56800,8520',
    );

    expect(screen.getByTestId(IMPORT_SUMMARY_TEST_ID)).toHaveTextContent(/0 trades ready/);
    expect(screen.getByTestId(IMPORT_SUMMARY_TEST_ID)).toHaveTextContent(
      /1 already in your portfolio/,
    );
  });

  it('says so when it cannot find the columns', async () => {
    await mountPortfolio();
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());
    await pressOn('portfolio-import');

    await typeInto(IMPORT_TEXT_TEST_ID, 'a,b,c\n1,2,3');

    expect(screen.getByTestId(IMPORT_UNREADABLE_TEST_ID)).toBeTruthy();
  });
});

describe('monthly plans', () => {
  it('saves a plan, says what its amount buys at the last price, and lists it with the next day', async () => {
    const { database } = await mountPortfolio({ VNM: 56870 });
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());

    await pressOn('portfolio-plan-add');
    await typeInto(PLAN_SYMBOL_TEST_ID, 'vnm');
    await typeInto(PLAN_AMOUNT_TEST_ID, '50000000');
    await waitFor(() => expect(screen.queryByTestId(PLAN_PREVIEW_TEST_ID)).not.toBeNull());
    expect(screen.getByTestId(PLAN_PREVIEW_TEST_ID)).toHaveTextContent(/800/);
    await typeInto(PLAN_DAY_TEST_ID, '12');
    await pressOn(PLAN_SAVE_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId('portfolio-plan-VNM')).not.toBeNull());
    expect(await readPlans(database)).toMatchObject([
      { symbol: 'VNM', amount: 50_000_000, day: 12 },
    ]);
  });

  it('refuses a day outside 1 to 28 and a missing amount, saving nothing', async () => {
    const { database } = await mountPortfolio({ VNM: 56870 });
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());

    await pressOn('portfolio-plan-add');
    await typeInto(PLAN_SYMBOL_TEST_ID, 'VNM');
    await typeInto(PLAN_DAY_TEST_ID, '31');
    await pressOn(PLAN_SAVE_TEST_ID);

    expect(screen.getByText(COPY.portfolio.dcaDayError)).toBeTruthy();
    expect(screen.getByText(COPY.portfolio.dcaAmountError)).toBeTruthy();
    expect(await readPlans(database)).toEqual([]);
  });

  it("opens this month's buy as a trade with the suggested shares and the last price", async () => {
    await mountPortfolio({ VNM: 56870 });
    await waitFor(() => expect(screen.queryByTestId('portfolio-empty')).not.toBeNull());
    await pressOn('portfolio-plan-add');
    await typeInto(PLAN_SYMBOL_TEST_ID, 'VNM');
    await typeInto(PLAN_AMOUNT_TEST_ID, '50000000');
    await pressOn(PLAN_SAVE_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId('portfolio-plan-VNM')).not.toBeNull());

    await pressOn('portfolio-plan-VNM');
    await waitFor(() => expect(screen.queryByTestId(PLAN_PREVIEW_TEST_ID)).not.toBeNull());
    await pressOn(PLAN_RECORD_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(TRADE_SUBMIT_TEST_ID)).not.toBeNull());
    expect(screen.getByTestId(TRADE_SYMBOL_TEST_ID).props.value).toBe('VNM');
    expect(String(screen.getByTestId(TRADE_QUANTITY_TEST_ID).props.value)).toMatch(/800/);
    expect(String(screen.getByTestId(TRADE_PRICE_TEST_ID).props.value)).toMatch(/56[.,]870/);
  });
});
