import { screen, waitFor } from '@testing-library/react-native';
import type { TransportRequest, TransportResponse } from '@/api/transport';
import { COPY } from '@/copy/strings';
import { writeUser } from '@/db/user';
import { PRICE_CHART_TEST_ID } from '@/invest/PriceChart';
import {
  ALERT_BELOW_TEST_ID,
  ALERT_PRICE_TEST_ID,
  ALERT_SAVE_TEST_ID,
} from '@/invest/AlertSheet';
import { readAlerts } from '@/invest/alerts';
import {
  BRIEF_BUTTON_TEST_ID,
  BRIEF_TEST_ID,
  NEWS_ITEM_PREFIX,
  NEWS_TEST_ID,
  resetBriefStateForTests,
} from '@/invest/NewsSection';
import { readWatchlist } from '@/invest/watchlist';
import InvestScreen from '../../app/(app)/(tabs)/invest';
import { apiError, mountScreen, ok, pressOn, typeInto, type MountedScreen } from '../support/mount';
import { resetRouter } from '../support/router';

jest.mock('expo-router');

/**
 * The Investing tab: it asks the server only when told to, shows what comes back, says so when the prices
 * are simulated, fills the calculator from the quote on request, and remembers watched symbols on the phone.
 */

const NOW = new Date(2026, 10, 6, 9, 0, 0);

const SERIES = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, '0')}`,
  close: 56000 + i * 30,
  volume: 1_000_000,
}));

function quote(demo = false) {
  return {
    data: {
      symbol: 'VNM',
      source: demo ? 'demo' : 'vnstock',
      demo,
      asOf: '2026-10-30',
      close: 56870,
      prevClose: 56840,
      changePct: 0.0005,
      high52w: 66000,
      low52w: 52000,
      series: SERIES,
    },
  };
}

const SIGNAL = {
  data: {
    symbol: 'VNM',
    source: 'vnstock',
    demo: false,
    label: 'Khá',
    score: 61,
    close: 56870,
    suggestedStop: 55136,
    stopPct: 0.03,
    liquid: true,
    reasons: ['Giá trên MA50'],
    warnings: [],
    disclaimer: 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.',
  },
};

const SIZE = {
  data: {
    shares: 400,
    lots: 4,
    cost: 20_030_000,
    allocPct: 0.2,
    maxLoss: 1_277_000,
    maxLossPct: 0.01277,
    breakeven: 50_200,
    limitedBy: 'rủi ro',
    message: null,
    disclaimer: 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.',
  },
};

const NEWS = {
  data: {
    items: [
      {
        symbol: 'VNM',
        source: 'CafeF',
        title: 'VNM công bố cổ tức tiền mặt',
        link: 'https://cafef.vn/vnm.chn',
        published: 't',
      },
      {
        symbol: 'VNM',
        source: 'VnExpress',
        title: 'Giá sữa tăng',
        link: 'https://vnexpress.net/sua.html',
        published: 't',
      },
    ],
  },
};

const BRIEF = {
  data: {
    overview: 'Thị trường đi ngang.',
    worldLink: '',
    topNews: [
      {
        title: 'VNM công bố cổ tức',
        symbols: ['VNM'],
        impact: 'tich_cuc',
        level: 'vua',
        comment: 'Tích cực.',
      },
    ],
    notes: [{ symbol: 'VNM', comment: 'Điểm kỹ thuật còn yếu.' }],
    risks: ['Lãi suất'],
    confidence: 'vua',
    disclaimer: 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.',
  },
};

interface Service {
  news?: TransportResponse;
  brief?: TransportResponse;
  quote?: TransportResponse;
  signal?: TransportResponse;
  size?: TransportResponse;
}

function market({ quote: q, signal, size, news, brief }: Service = {}) {
  return async (request: TransportRequest): Promise<TransportResponse> => {
    if (request.path === '/v1/market/quotes/VNM') return q ?? ok(200, quote());
    if (request.path === '/v1/market/signals/VNM') return signal ?? ok(200, SIGNAL);
    if (request.path === '/v1/market/position-size') return size ?? ok(200, SIZE);
    if (request.path === '/v1/market/news') return news ?? ok(200, NEWS);
    if (request.path === '/v1/market/brief') return brief ?? ok(200, BRIEF);
    throw new Error(`unexpected request ${request.method} ${request.path}`);
  };
}

async function mountInvest(service: Service = {}): Promise<MountedScreen> {
  return mountScreen(<InvestScreen />, {
    clock: () => NOW,
    transport: market(service),
    seed: async (database) => {
      await writeUser(database, {
        id: '0192f5a0-0000-7000-8000-00000000a001',
        email: 'ada@example.com',
        currency: 'VND',
        createdAt: '2026-10-01T00:00:00.000Z',
      });
    },
  });
}

async function lookUpVnm(): Promise<void> {
  await typeInto('invest-symbol', 'vnm');
  await pressOn('invest-lookup');
  await waitFor(() => expect(screen.queryByTestId('invest-quote')).not.toBeNull());
}

const marketRequests = (requests: readonly TransportRequest[]) =>
  requests.filter(
    (request) =>
      request.path.startsWith('/v1/market') &&
      // Headlines load on their own for what is watched and looked at; this is about the lookup.
      !request.path.endsWith('/news'),
  );

beforeEach(() => {
  resetRouter();
  resetBriefStateForTests();
});

describe('looking a stock up', () => {
  it('asks for nothing until the button is pressed, then shows the quote, the chart and the score', async () => {
    const { requests } = await mountInvest();
    expect(marketRequests(requests)).toEqual([]);

    await lookUpVnm();

    expect(
      marketRequests(requests)
        .map((r) => r.path)
        .sort(),
    ).toEqual(['/v1/market/quotes/VNM', '/v1/market/signals/VNM']);
    expect(screen.getByText('VNM')).toBeTruthy();
    expect(screen.getByTestId(PRICE_CHART_TEST_ID)).toBeTruthy();
    expect(screen.getByTestId('invest-signal')).toBeTruthy();
    expect(screen.getByText(COPY.invest.disclaimer)).toBeTruthy();
    expect(screen.queryByTestId('invest-demo')).toBeNull();
  });

  it('says plainly when the prices are simulated', async () => {
    await mountInvest({ quote: ok(200, quote(true)) });

    await lookUpVnm();

    expect(screen.getByText(COPY.invest.demoBanner)).toBeTruthy();
  });

  it('says market data is unavailable when the quote cannot be had, and shows no stale card', async () => {
    await mountInvest({
      quote: apiError(503, 'market_unavailable'),
    });

    await typeInto('invest-symbol', 'vnm');
    await pressOn('invest-lookup');

    await waitFor(() => expect(screen.queryByTestId('invest-unavailable')).not.toBeNull());
    expect(screen.queryByTestId('invest-quote')).toBeNull();
  });

  it('says the symbol was not found, not that the service is down, for a ticker with no prices', async () => {
    await mountInvest({ quote: apiError(404, 'not_found'), signal: apiError(404, 'not_found') });

    await typeInto('invest-symbol', 'vnm');
    await pressOn('invest-lookup');

    await waitFor(() => expect(screen.queryByTestId('invest-unavailable')).not.toBeNull());
    expect(screen.getByText(COPY.invest.notFound)).toBeTruthy();
    expect(screen.queryByText(COPY.invest.unavailable)).toBeNull();
  });

  it('shows the symbol upper-cased as it is typed', async () => {
    await mountInvest();

    await typeInto('invest-symbol', 'vnm');

    expect(screen.getByTestId('invest-symbol').props.value).toBe('VNM');
  });

  it('still shows the quote when only the score fails', async () => {
    await mountInvest({
      signal: apiError(503, 'market_unavailable'),
    });

    await lookUpVnm();

    expect(screen.queryByTestId('invest-signal')).toBeNull();
    expect(screen.getByTestId(PRICE_CHART_TEST_ID)).toBeTruthy();
  });
});

describe('the calculator', () => {
  it('fills the entry and the stop-loss from the quote and the score on request', async () => {
    await mountInvest();
    await lookUpVnm();

    await pressOn('invest-use-prices');

    expect(String(screen.getByTestId('invest-entry').props.value).replace(/\D/g, '')).toBe('56870');
    expect(String(screen.getByTestId('invest-stop').props.value).replace(/\D/g, '')).toBe('55136');
  });

  it('sizes a position and shows the lots and the most that can be lost', async () => {
    const { requests } = await mountInvest();
    await typeInto('invest-capital', '100000000');
    await typeInto('invest-entry', '50000');
    await typeInto('invest-stop', '47000');

    await pressOn('invest-calculate');

    await waitFor(() => expect(screen.queryByTestId('invest-result')).not.toBeNull());
    expect(screen.getByText('400 shares (4 lots)')).toBeTruthy();
    const sent = requests.find((r) => r.path === '/v1/market/position-size');
    expect(sent?.body).toEqual({ capital: 100000000, entry: 50000, stop: 47000 });
  });

  it('refuses a stop-loss at or above the entry without asking the server', async () => {
    const { requests } = await mountInvest();
    await typeInto('invest-capital', '100000000');
    await typeInto('invest-entry', '50000');
    await typeInto('invest-stop', '50000');

    await pressOn('invest-calculate');

    expect(screen.getByText(COPY.invest.stopBelowEntry)).toBeTruthy();
    expect(marketRequests(requests)).toEqual([]);
  });
});

describe('the watchlist', () => {
  it('keeps a watched symbol on the phone and looks it up again on a tap', async () => {
    const { database, requests } = await mountInvest();
    await lookUpVnm();

    await pressOn('invest-watch-toggle');

    await waitFor(() => expect(screen.queryByTestId('invest-watch-VNM')).not.toBeNull());
    expect(await readWatchlist(database)).toEqual(['VNM']);
    expect(screen.getByLabelText(COPY.invest.unwatch)).toBeTruthy();

    const before = marketRequests(requests).length;
    await pressOn('invest-watch-VNM');
    await waitFor(() => expect(marketRequests(requests).length).toBeGreaterThan(before));
  });

  it('forgets a symbol when it is removed', async () => {
    const { database } = await mountInvest();
    await lookUpVnm();
    await pressOn('invest-watch-toggle');
    await waitFor(() => expect(screen.queryByTestId('invest-watch-VNM')).not.toBeNull());

    await pressOn('invest-watch-toggle');

    await waitFor(() => expect(screen.queryByTestId('invest-watch-VNM')).toBeNull());
    expect(await readWatchlist(database)).toEqual([]);
  });
});

describe('price alerts', () => {
  it('sets an alert from the bell, starting five percent above the last close, and lists it', async () => {
    const { database } = await mountInvest();
    await lookUpVnm();

    await pressOn('invest-alert-add');
    expect(String(screen.getByTestId(ALERT_PRICE_TEST_ID).props.value).replace(/\D/g, '')).toBe(
      '59714',
    );
    await pressOn(ALERT_SAVE_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId('invest-alerts')).not.toBeNull());
    expect(await readAlerts(database)).toMatchObject([
      { symbol: 'VNM', direction: 'above', price: 59714 },
    ]);
  });

  it('starts five percent below when the alert is for a fall, and takes a price typed over it', async () => {
    const { database } = await mountInvest();
    await lookUpVnm();

    await pressOn('invest-alert-add');
    await pressOn(ALERT_BELOW_TEST_ID);
    expect(String(screen.getByTestId(ALERT_PRICE_TEST_ID).props.value).replace(/\D/g, '')).toBe(
      '54027',
    );
    await typeInto(ALERT_PRICE_TEST_ID, '50000');
    await pressOn(ALERT_SAVE_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId('invest-alerts')).not.toBeNull());
    expect(await readAlerts(database)).toMatchObject([{ direction: 'below', price: 50000 }]);
  });

  it('refuses an empty price and removes an alert from the list', async () => {
    const { database } = await mountInvest();
    await lookUpVnm();
    await pressOn('invest-alert-add');
    await typeInto(ALERT_PRICE_TEST_ID, '');
    await pressOn(ALERT_SAVE_TEST_ID);
    expect(screen.getByText(COPY.invest.alertPriceError)).toBeTruthy();
    expect(await readAlerts(database)).toEqual([]);

    await typeInto(ALERT_PRICE_TEST_ID, '60000');
    await pressOn(ALERT_SAVE_TEST_ID);
    await waitFor(() => expect(screen.queryByTestId('invest-alerts')).not.toBeNull());
    const [alert] = await readAlerts(database);

    await pressOn(`invest-alert-remove-${alert!.id}`);

    await waitFor(() => expect(screen.queryByTestId('invest-alerts')).toBeNull());
    expect(await readAlerts(database)).toEqual([]);
  });
});

describe('news and the brief', () => {
  it('lists headlines that name the stocks, and asks for them once the stock is looked up', async () => {
    const { requests } = await mountInvest();
    await lookUpVnm();

    await waitFor(() => expect(screen.queryByTestId(`${NEWS_ITEM_PREFIX}-0`)).not.toBeNull());
    expect(screen.getByText('VNM công bố cổ tức tiền mặt')).toBeTruthy();
    const asked = requests.filter((r) => r.path === '/v1/market/news');
    expect(asked.at(-1)?.query).toMatchObject({ symbols: 'VNM' });
  });

  it('says plainly when no headline names the stocks', async () => {
    await mountInvest({ news: ok(200, { data: { items: [] } }) });
    await lookUpVnm();

    await waitFor(() => expect(screen.queryByText(COPY.invest.newsEmpty)).not.toBeNull());
  });

  it('writes the brief only when asked, says it is AI, and shows it', async () => {
    const { requests } = await mountInvest();
    await lookUpVnm();
    await waitFor(() => expect(screen.queryByTestId(BRIEF_BUTTON_TEST_ID)).not.toBeNull());
    expect(requests.some((r) => r.path === '/v1/market/brief')).toBe(false);
    expect(screen.getByText(COPY.invest.briefHint)).toBeTruthy();

    await pressOn(BRIEF_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(BRIEF_TEST_ID)).not.toBeNull());
    expect(screen.getByText('Thị trường đi ngang.')).toBeTruthy();
    expect(screen.getByText(COPY.invest.briefByAi)).toBeTruthy();
    expect(screen.getByText('VNM: Điểm kỹ thuật còn yếu.')).toBeTruthy();
  });

  it('hides the brief button for the session when the server has no AI, and says so when it fails otherwise', async () => {
    await mountInvest({ brief: apiError(503, 'market_unavailable') });
    await lookUpVnm();
    await waitFor(() => expect(screen.queryByTestId(BRIEF_BUTTON_TEST_ID)).not.toBeNull());

    await pressOn(BRIEF_BUTTON_TEST_ID);

    await waitFor(() => expect(screen.queryByTestId(BRIEF_BUTTON_TEST_ID)).toBeNull());
    expect(screen.queryByTestId(NEWS_TEST_ID)).not.toBeNull();
  });
});
