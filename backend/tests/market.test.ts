import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@expense-tracker/shared';
import { resetConfigForTests } from '../src/config.ts';
import { clearMarketCache } from '../src/services/marketService.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * `/v1/market/*`: the server asks the market service and hands the device a checked shape. The
 * service is faked (`fetch` is stubbed), so no test depends on the network; every case is about
 * what the server does with what comes back, and that nothing of the service's own wording leaks.
 */

const QUOTE = {
  symbol: 'VNM',
  source: 'vnstock',
  demo: false,
  as_of: '2026-11-06',
  close: 56800,
  prev_close: 56500,
  change_pct: 0.0053,
  high_52w: 66000,
  low_52w: 52000,
  series: [
    { date: '2026-11-05', close: 56500, volume: 1200000 },
    { date: '2026-11-06', close: 56800, volume: 1500000 },
  ],
};

const SIGNAL = {
  symbol: 'VNM',
  source: 'vnstock',
  demo: false,
  label: 'Yếu',
  score: 15,
  close: 56800,
  suggested_stop: 55136,
  stop_pct: 0.0293,
  liquid: true,
  reasons: ['Giá dưới MA50'],
  warnings: [],
  disclaimer: 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.',
};

const SIZE = {
  shares: 400,
  lots: 4,
  cost: 20030000,
  alloc_pct: 0.2003,
  max_loss: 1277000,
  max_loss_pct: 0.01277,
  breakeven: 50200.5,
  limited_by: 'rủi ro',
  disclaimer: 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.',
};

function service(body: unknown, status = 200) {
  return vi.fn(
    async (_url: unknown, _init?: unknown) => new Response(JSON.stringify(body), { status }),
  );
}

describe('/v1/market', () => {
  beforeEach(() => {
    clearMarketCache();
    vi.stubEnv('MARKET_API_URL', 'http://market.test:8001');
    vi.stubEnv('MARKET_API_KEY', 'service-secret');
    resetConfigForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  it('requires authentication on every route', async () => {
    expect((await api().get('/v1/market/quotes/VNM')).status).toBe(401);
    expect((await api().get('/v1/market/signals/VNM')).status).toBe(401);
    expect((await api().post('/v1/market/position-size').send({})).status).toBe(401);
  });

  it('answers a quote in camelCase, upper-casing the symbol and sending the service key', async () => {
    const fetcher = service(QUOTE);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const response = await api().get('/v1/market/quotes/vnm').set('Authorization', user.auth);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      symbol: 'VNM',
      demo: false,
      asOf: '2026-11-06',
      prevClose: 56500,
      high52w: 66000,
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe('/v1/quotes/VNM');
    expect((init as { headers: Record<string, string> }).headers['x-api-key']).toBe(
      'service-secret',
    );
  });

  it('passes the demo flag through so the app can label simulated prices', async () => {
    vi.stubGlobal('fetch', service({ ...QUOTE, source: 'demo', demo: true }));
    const user = await createUser();

    const response = await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);

    expect(response.body.data.demo).toBe(true);
  });

  it('serves a repeat quote from the cache', async () => {
    const fetcher = service(QUOTE);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);
    await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('answers a signal with the disclaimer, and an unknown label as N/A', async () => {
    vi.stubGlobal('fetch', service({ ...SIGNAL, label: 'Tăng mạnh' }));
    const user = await createUser();

    const response = await api().get('/v1/market/signals/VNM').set('Authorization', user.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.label).toBe('N/A');
    expect(response.body.data.suggestedStop).toBe(55136);
    expect(response.body.data.disclaimer).toContain('không phải lời khuyên');
  });

  it.each(['a-b', 'toolongsymbol1', '%20'])(
    'rejects the symbol %s without calling out',
    async (bad) => {
      const fetcher = service(QUOTE);
      vi.stubGlobal('fetch', fetcher);
      const user = await createUser();

      const response = await api().get(`/v1/market/quotes/${bad}`).set('Authorization', user.auth);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('validation_error');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('sizes a position and maps the request to the service names', async () => {
    const fetcher = service(SIZE);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const response = await api()
      .post('/v1/market/position-size')
      .set('Authorization', user.auth)
      .send({ capital: 100000000, entry: 50000, stop: 47000, riskPct: 0.01 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      shares: 400,
      lots: 4,
      allocPct: 0.2003,
      message: null,
    });
    const sent = JSON.parse(String((fetcher.mock.calls[0]?.[1] as { body: string }).body));
    expect(sent).toEqual({ capital: 100000000, entry: 50000, stop: 47000, risk_pct: 0.01 });
  });

  it('rejects a stop at or above the entry before calling out', async () => {
    const fetcher = service(SIZE);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const response = await api()
      .post('/v1/market/position-size')
      .set('Authorization', user.auth)
      .send({ capital: 100000000, entry: 50000, stop: 50000 });

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('answers 503 market_unavailable when the service is not configured', async () => {
    vi.stubEnv('MARKET_API_URL', '');
    vi.unstubAllEnvs();
    delete process.env['MARKET_API_URL'];
    resetConfigForTests();
    const fetcher = service(QUOTE);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const response = await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('market_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['the service answers 500', () => service({ detail: 'boom at /secret/path' }, 500)],
    ['the service answers something unusable', () => service({ nope: true })],
    [
      'the service cannot be reached',
      () =>
        vi.fn(async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:8001');
        }),
    ],
  ])('answers 503 market_unavailable, with nothing of the cause, when %s', async (_name, make) => {
    vi.stubGlobal('fetch', make());
    const user = await createUser();

    const response = await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('market_unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/secret|ECONNREFUSED|10\.0\.0\.5/);
  });

  it('answers 404 not_found when the service has no prices for the symbol', async () => {
    vi.stubGlobal('fetch', service({ detail: 'no price data' }, 404));
    const user = await createUser();

    const response = await api().get('/v1/market/quotes/NOSUCH').set('Authorization', user.auth);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });

  it('answers headlines for the stocks, dropping any link that is not http(s), and sends the symbols sorted', async () => {
    const fetcher = service({
      items: [
        { symbol: 'VNM', source: 'CafeF', title: 'A', link: 'https://cafef.vn/a', published: 't' },
        { symbol: 'FPT', source: 'CafeF', title: 'B', link: 'javascript:alert(1)', published: 't' },
        {
          symbol: 'FPT',
          source: 'VnExpress',
          title: 'C',
          link: 'http://vnexpress.net/c',
          published: 't',
        },
      ],
    });
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const response = await api()
      .get('/v1/market/news?symbols=vnm,fpt')
      .set('Authorization', user.auth);

    expect(response.status).toBe(200);
    expect(response.body.data.items.map((i: { title: string }) => i.title)).toEqual(['A', 'C']);
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/v1/news');
    expect(url.searchParams.get('symbols')).toBe('FPT,VNM');
  });

  it.each(['', 'a-b', 'VNM,,FPT', Array.from({ length: 21 }, (_, i) => `S${i}`).join(',')])(
    'rejects the symbols %j before calling out',
    async (symbols) => {
      const fetcher = service({ items: [] });
      vi.stubGlobal('fetch', fetcher);
      const user = await createUser();

      const news = await api()
        .get('/v1/market/news')
        .query({ symbols })
        .set('Authorization', user.auth);
      const brief = await api()
        .get('/v1/market/brief')
        .query({ symbols })
        .set('Authorization', user.auth);

      expect(news.status).toBe(400);
      expect(brief.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('requires authentication for headlines and the brief', async () => {
    expect((await api().get('/v1/market/news?symbols=VNM')).status).toBe(401);
    expect((await api().get('/v1/market/brief?symbols=VNM')).status).toBe(401);
  });

  it('passes the brief through, with an unknown impact read as neutral, and caches it', async () => {
    const fetcher = service({
      overview: 'Thị trường đi ngang.',
      worldLink: '',
      topNews: [
        { title: 'A', symbols: ['VNM'], impact: 'tich_cuc', level: 'vua', comment: 'x' },
        { title: 'B', symbols: [], impact: 'weird', level: 'cao', comment: 'y' },
      ],
      notes: [{ symbol: 'VNM', comment: 'yếu' }],
      risks: ['lãi suất'],
      confidence: 'vua',
      disclaimer: 'Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư.',
    });
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const first = await api().get('/v1/market/brief?symbols=VNM').set('Authorization', user.auth);
    await api().get('/v1/market/brief?symbols=vnm').set('Authorization', user.auth);

    expect(first.status).toBe(200);
    expect(first.body.data.topNews.map((n: { impact: string }) => n.impact)).toEqual([
      'tich_cuc',
      'trung_tinh',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('answers 503 market_unavailable when the service has no model, without its detail', async () => {
    vi.stubGlobal('fetch', service({ detail: 'no llm configured: key sk-abc' }, 503));
    const user = await createUser();

    const response = await api()
      .get('/v1/market/brief?symbols=VNM')
      .set('Authorization', user.auth);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('market_unavailable');
    expect(JSON.stringify(response.body)).not.toMatch(/sk-abc|llm/);
  });

  it('never caches a failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(QUOTE), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const first = await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);
    const second = await api().get('/v1/market/quotes/VNM').set('Authorization', user.auth);

    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
  });
  describe('POST /v1/assistant/ask', () => {
    const ask = { question: 'Tháng này tôi tiêu gì nhiều?', context: 'Ăn uống: 3.200.000' };
    const ANSWER = { answer: '- Ăn uống.', disclaimer: 'Không phải lời khuyên đầu tư.' };

    it('needs a sign-in', async () => {
      expect((await api().post('/v1/assistant/ask').send(ask)).status).toBe(401);
    });

    it('forwards the question and the digest, answers what came back, and caches nothing', async () => {
      const fetcher = service(ANSWER);
      vi.stubGlobal('fetch', fetcher);
      const user = await createUser();

      const first = await api().post('/v1/assistant/ask').set('Authorization', user.auth).send(ask);
      await api().post('/v1/assistant/ask').set('Authorization', user.auth).send(ask);

      expect(first.status).toBe(200);
      expect(first.body.data).toEqual(ANSWER);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [url, init] = fetcher.mock.calls[0] ?? [];
      expect(new URL(String(url)).pathname).toBe('/v1/assistant');
      expect(JSON.parse(String((init as { body: string }).body))).toEqual(ask);
    });

    it('refuses an empty or oversized question before calling out', async () => {
      const fetcher = service(ANSWER);
      vi.stubGlobal('fetch', fetcher);
      const user = await createUser();

      for (const body of [
        { question: '  ', context: 'x' },
        { question: 'x'.repeat(501), context: 'x' },
        { question: 'x', context: 'y'.repeat(6001) },
        { question: 'x', context: 'y', extra: 1 },
      ]) {
        const r = await api().post('/v1/assistant/ask').set('Authorization', user.auth).send(body);
        expect(r.status).toBe(400);
      }
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('answers a failure as the one opaque market_unavailable', async () => {
      vi.stubGlobal('fetch', service({ detail: 'bad key sk-abc' }, 502));
      const user = await createUser();

      const r = await api().post('/v1/assistant/ask').set('Authorization', user.auth).send(ask);

      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('market_unavailable');
      expect(JSON.stringify(r.body)).not.toMatch(/sk-abc/);
    });

    it('limits each account, not everyone', async () => {
      vi.stubGlobal('fetch', service(ANSWER));
      const busy = await createUser();
      const other = await createUser();

      for (let i = 0; i < LIMITS.ASSISTANT_MAX_PER_USER; i += 1) {
        const r = await api().post('/v1/assistant/ask').set('Authorization', busy.auth).send(ask);
        expect(r.status).toBe(200);
      }
      const limited = await api()
        .post('/v1/assistant/ask')
        .set('Authorization', busy.auth)
        .send(ask);

      expect(limited.status).toBe(429);
      expect(
        (await api().post('/v1/assistant/ask').set('Authorization', other.auth).send(ask)).status,
      ).toBe(200);
    });
  });
});
