import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRateCache } from '../src/services/ratesService.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';

/**
 * `GET /v1/rates`: the server fetches a daily rate from a free public provider and hands the
 * device a decimal string. The provider is faked here (`fetch` is stubbed), so no test depends
 * on the network, and every case below is about what the server does with what comes back.
 */

function provider(body: unknown, status = 200) {
  return vi.fn(
    async (_url: unknown, _init?: unknown) => new Response(JSON.stringify(body), { status }),
  );
}

const OK = { amount: 1, base: 'EUR', date: '2026-10-05', rates: { USD: 1.0823 } };

describe('GET /v1/rates', () => {
  beforeEach(() => clearRateCache());
  afterEach(() => vi.unstubAllGlobals());

  it('requires authentication', async () => {
    const response = await api().get('/v1/rates?from=EUR&to=USD');
    expect(response.status).toBe(401);
  });

  it('answers the rate as a decimal string, on the day the provider actually priced', async () => {
    const fetcher = provider(OK);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    const response = await api()
      .get('/v1/rates?from=EUR&to=USD&date=2026-10-06')
      .set('Authorization', user.auth);

    expect(response.status).toBe(200);
    // The 6th was a Sunday, so the provider priced the Friday - and the answer says so.
    expect(response.body).toEqual({
      data: { from: 'EUR', to: 'USD', date: '2026-10-05', rate: '1.0823' },
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get('base')).toBe('EUR');
    expect(url.searchParams.get('symbols')).toBe('USD');
    expect(url.pathname).toContain('2026-10-06');
  });

  it('asks for the latest rate when no day is given', async () => {
    const fetcher = provider(OK);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    await api().get('/v1/rates?from=EUR&to=USD').set('Authorization', user.auth);

    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toContain('latest');
  });

  it('never prints a rate in exponent form', async () => {
    vi.stubGlobal(
      'fetch',
      provider({ base: 'JPY', date: '2026-10-05', rates: { USD: 0.0000071 } }),
    );
    const user = await createUser();

    const response = await api().get('/v1/rates?from=JPY&to=USD').set('Authorization', user.auth);

    expect(response.body.data.rate).toBe('0.0000071');
  });

  it('serves a repeat from the cache without calling the provider again', async () => {
    const fetcher = provider(OK);
    vi.stubGlobal('fetch', fetcher);
    const user = await createUser();

    await api().get('/v1/rates?from=EUR&to=USD&date=2026-10-05').set('Authorization', user.auth);
    await api().get('/v1/rates?from=EUR&to=USD&date=2026-10-05').set('Authorization', user.auth);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses a pair of one currency', async () => {
    const user = await createUser();
    const response = await api().get('/v1/rates?from=USD&to=USD').set('Authorization', user.auth);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });

  it('refuses a malformed pair', async () => {
    const user = await createUser();
    const response = await api().get('/v1/rates?from=eur&to=USD').set('Authorization', user.auth);
    expect(response.status).toBe(400);
  });

  it.each([
    ['the provider is down', () => provider({}, 503)],
    ['the provider does not know the pair', () => provider({ message: 'not found' }, 404)],
    ['the provider answers nonsense', () => provider({ rates: {} })],
    [
      'the provider answers a zero rate',
      () => provider({ base: 'EUR', date: '2026-10-05', rates: { USD: 0 } }),
    ],
    [
      'the network fails',
      () =>
        vi.fn(async () => {
          throw new Error('ECONNRESET');
        }),
    ],
  ])(
    'answers 502 rates_unavailable when %s, and does not cache the failure',
    async (_name, make) => {
      vi.stubGlobal('fetch', make());
      const user = await createUser();

      const response = await api()
        .get('/v1/rates?from=EUR&to=USD&date=2026-10-05')
        .set('Authorization', user.auth);

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe('rates_unavailable');

      // A transient failure must not poison the cache: the next call asks again.
      const fetcher = provider(OK);
      vi.stubGlobal('fetch', fetcher);
      const retry = await api()
        .get('/v1/rates?from=EUR&to=USD&date=2026-10-05')
        .set('Authorization', user.auth);
      expect(retry.status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('gives up on a provider that hangs instead of holding the request open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    const user = await createUser();

    const response = await api()
      .get('/v1/rates?from=EUR&to=USD&date=2026-10-05')
      .set('Authorization', user.auth);

    expect(response.status).toBe(502);
  }, 15000);
});
