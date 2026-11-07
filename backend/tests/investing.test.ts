import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '../src/config.ts';
import { getPrisma } from '../src/db/client.ts';
import { runAlertPass } from '../src/services/alertJob.ts';
import { clearMarketCache } from '../src/services/marketService.ts';
import { api } from './support/api.ts';
import { createUser, type TestUser } from './support/fixtures.ts';

/**
 * The investing settings (one document per account, replaced under optimistic concurrency), the push tokens, and the
 * job that pushes a price alert while the app is closed. The market service and Expo's push service are faked
 * (`fetch` is stubbed), so no test depends on the network.
 */

const alert = (
  id: string,
  symbol = 'VNM',
  direction: 'above' | 'below' = 'above',
  price = 60000,
) => ({
  id,
  symbol,
  direction,
  price,
  firedAt: null,
  firedPrice: null,
});

const get = (user: TestUser) => api().get('/v1/me/investing').set('Authorization', user.auth);
const put = (user: TestUser, body: unknown) =>
  api()
    .put('/v1/me/investing')
    .set('Authorization', user.auth)
    .send(body as object);

describe('/v1/me/investing', () => {
  it('needs a sign-in', async () => {
    expect((await api().get('/v1/me/investing')).status).toBe(401);
    expect((await api().put('/v1/me/investing').send({})).status).toBe(401);
    expect((await api().post('/v1/me/push-token').send({})).status).toBe(401);
  });

  it('is empty at version 0 before the first write', async () => {
    const user = await createUser();
    const response = await get(user);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ watchlist: [], alerts: [], version: 0 });
  });

  it('stores a write made on the current version and raises it by one', async () => {
    const user = await createUser();

    const first = await put(user, {
      watchlist: ['VNM', 'FPT'],
      alerts: [alert('a1')],
      baseVersion: 0,
    });
    const second = await put(user, { watchlist: ['FPT'], alerts: [], baseVersion: 1 });

    expect(first.body).toMatchObject({
      applied: true,
      data: { version: 1, watchlist: ['VNM', 'FPT'] },
    });
    expect(second.body).toMatchObject({
      applied: true,
      data: { version: 2, watchlist: ['FPT'], alerts: [] },
    });
    expect((await get(user)).body.data.version).toBe(2);
  });

  it('refuses a stale write, changes nothing, and hands back the current document', async () => {
    const user = await createUser();
    await put(user, { watchlist: ['VNM'], alerts: [], baseVersion: 0 });
    await put(user, { watchlist: ['VNM', 'FPT'], alerts: [], baseVersion: 1 });

    const stale = await put(user, { watchlist: ['HPG'], alerts: [], baseVersion: 1 });

    expect(stale.status).toBe(200);
    expect(stale.body.applied).toBe(false);
    expect(stale.body.data).toEqual({ watchlist: ['VNM', 'FPT'], alerts: [], version: 2 });
  });

  it('lets only one of two first writes win', async () => {
    const user = await createUser();
    const [a, b] = await Promise.all([
      put(user, { watchlist: ['VNM'], alerts: [], baseVersion: 0 }),
      put(user, { watchlist: ['FPT'], alerts: [], baseVersion: 0 }),
    ]);
    expect([a.body.applied, b.body.applied].sort()).toEqual([false, true]);
    expect((await get(user)).body.data.version).toBe(1);
  });

  it('keeps one account apart from another', async () => {
    const ada = await createUser();
    const bob = await createUser();
    await put(ada, { watchlist: ['VNM'], alerts: [alert('a1')], baseVersion: 0 });

    expect((await get(bob)).body.data).toEqual({ watchlist: [], alerts: [], version: 0 });
  });

  it('drops a repeated symbol or alert id rather than store it twice', async () => {
    const user = await createUser();
    const r = await put(user, {
      watchlist: ['VNM', 'VNM', 'FPT'],
      alerts: [alert('a1'), alert('a1', 'FPT')],
      baseVersion: 0,
    });
    expect(r.body.data.watchlist).toEqual(['VNM', 'FPT']);
    expect(r.body.data.alerts).toHaveLength(1);
  });

  it('refuses malformed documents before storing anything', async () => {
    const user = await createUser();
    const bad = [
      { watchlist: ['vnm'], alerts: [], baseVersion: 0 },
      { watchlist: Array.from({ length: 21 }, (_, i) => `S${i}`), alerts: [], baseVersion: 0 },
      {
        watchlist: [],
        alerts: Array.from({ length: 21 }, (_, i) => alert(`a${i}`)),
        baseVersion: 0,
      },
      { watchlist: [], alerts: [{ ...alert('a1'), price: 0 }], baseVersion: 0 },
      { watchlist: [], alerts: [{ ...alert('a1'), price: 1.5 }], baseVersion: 0 },
      { watchlist: [], alerts: [], baseVersion: -1 },
      { watchlist: [], alerts: [], baseVersion: 0, extra: 1 },
    ];
    for (const body of bad) expect((await put(user, body)).status).toBe(400);
    expect((await get(user)).body.data.version).toBe(0);
  });
});

describe('/v1/me/push-token', () => {
  const TOKEN = 'ExponentPushToken[abcdefghijklmnopqrstuv]';

  it('records a token, and moves it to whoever registers it next', async () => {
    const ada = await createUser();
    const bob = await createUser();

    const first = await api()
      .post('/v1/me/push-token')
      .set('Authorization', ada.auth)
      .send({ token: TOKEN, platform: 'android' });
    await api()
      .post('/v1/me/push-token')
      .set('Authorization', bob.auth)
      .send({ token: TOKEN, platform: 'ios' });

    expect(first.status).toBe(204);
    const rows = await getPrisma().pushToken.findMany({ where: { token: TOKEN } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(bob.user.id);
    expect(rows[0]?.platform).toBe('ios');
  });

  it('refuses what is not an Expo push token', async () => {
    const user = await createUser();
    for (const token of ['', 'abc', 'ExponentPushToken[', 'fcm:APA91b...']) {
      const r = await api()
        .post('/v1/me/push-token')
        .set('Authorization', user.auth)
        .send({ token, platform: 'ios' });
      expect(r.status).toBe(400);
    }
  });
});

describe('the alert job', () => {
  const TOKEN = 'ExponentPushToken[jobjobjobjobjobjobjob]';
  const NOW = new Date('2026-11-09T09:00:00.000Z');

  beforeEach(() => {
    clearMarketCache();
    vi.stubEnv('MARKET_API_URL', 'http://market.test:8001');
    resetConfigForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfigForTests();
  });

  /** A fake of both services: quotes by symbol from `closes`, and Expo's push endpoint recording what it got. */
  function services(
    closes: Record<string, number>,
    pushStatus: 'ok' | 'DeviceNotRegistered' = 'ok',
    onQuote?: () => Promise<void>,
  ) {
    const pushed: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: unknown, init?: unknown) => {
      const href = String(url);
      if (href.includes('exp.host')) {
        const sent = JSON.parse(String((init as { body: string }).body)) as Array<
          Record<string, unknown>
        >;
        pushed.push(...sent);
        return new Response(
          JSON.stringify({
            data: sent.map(() =>
              pushStatus === 'ok'
                ? { status: 'ok' }
                : { status: 'error', details: { error: 'DeviceNotRegistered' } },
            ),
          }),
          { status: 200 },
        );
      }
      await onQuote?.();
      const symbol = /\/v1\/quotes\/(\w+)/.exec(href)?.[1] ?? '';
      const close = closes[symbol];
      if (close === undefined) return new Response('{}', { status: 502 });
      return new Response(
        JSON.stringify({
          symbol,
          source: 'vnstock',
          demo: false,
          as_of: '2026-11-09',
          close,
          prev_close: close,
          change_pct: 0,
          high_52w: close,
          low_52w: close,
          series: [{ date: '2026-11-09', close, volume: 1 }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetcher);
    return { pushed, fetcher };
  }

  async function seed(alerts: ReturnType<typeof alert>[]) {
    const user = await createUser();
    await put(user, { watchlist: [], alerts, baseVersion: 0 });
    await api()
      .post('/v1/me/push-token')
      .set('Authorization', user.auth)
      .send({ token: TOKEN, platform: 'android' });
    return user;
  }

  it('pushes an alert a price has reached, marks it fired, and does not push it twice', async () => {
    const { pushed } = services({ VNM: 61000 });
    const user = await seed([alert('a1', 'VNM', 'above', 60000)]);

    const first = await runAlertPass(NOW);
    const second = await runAlertPass(NOW);

    expect(first.fired).toBe(1);
    expect(second.fired).toBe(0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ to: TOKEN, data: { type: 'price-alert', symbol: 'VNM' } });
    const doc = (await get(user)).body.data;
    expect(doc.alerts[0]).toMatchObject({ firedAt: NOW.toISOString(), firedPrice: 61000 });
    expect(doc.version).toBe(2);
  });

  it('fires a below-alert at or under its price, and leaves one the price has not reached', async () => {
    const { pushed } = services({ VNM: 51000, FPT: 100000 });
    const user = await seed([
      alert('a1', 'VNM', 'below', 52000),
      alert('a2', 'FPT', 'above', 120000),
    ]);

    await runAlertPass(NOW);

    expect(pushed).toHaveLength(1);
    const doc = (await get(user)).body.data;
    expect(doc.alerts.find((a: { id: string }) => a.id === 'a1').firedAt).not.toBeNull();
    expect(doc.alerts.find((a: { id: string }) => a.id === 'a2').firedAt).toBeNull();
  });

  it('skips a symbol whose price cannot be had: never read as a drop', async () => {
    const { pushed } = services({});
    const user = await seed([alert('a1', 'VNM', 'below', 52000)]);

    const result = await runAlertPass(NOW);

    expect(result.fired).toBe(0);
    expect(pushed).toHaveLength(0);
    expect((await get(user)).body.data.alerts[0].firedAt).toBeNull();
  });

  it('asks for each symbol once, however many accounts watch it', async () => {
    const { fetcher } = services({ VNM: 61000 });
    await seed([alert('a1', 'VNM', 'above', 60000)]);
    await seed([alert('b1', 'VNM', 'above', 59000)]);

    const result = await runAlertPass(NOW);

    expect(result.fired).toBe(2);
    const quoteCalls = fetcher.mock.calls.filter(([u]) => String(u).includes('/v1/quotes/'));
    expect(quoteCalls).toHaveLength(1);
  });

  it('does not overwrite an edit made while it ran: the person wins and the alert waits for the next pass', async () => {
    const user = await seed([alert('a1', 'VNM', 'above', 60000)]);
    let edited = false;
    // The edit lands after the job has read the document and before it writes: during its price lookup.
    services({ VNM: 61000 }, 'ok', async () => {
      if (edited) return;
      edited = true;
      await put(user, {
        watchlist: ['FPT'],
        alerts: [alert('a1', 'VNM', 'above', 60000)],
        baseVersion: 1,
      });
    });

    const first = await runAlertPass(NOW);

    expect(first.fired).toBe(0);
    const doc = (await get(user)).body.data;
    expect(doc.watchlist).toEqual(['FPT']);
    expect(doc.alerts[0].firedAt).toBeNull();
    expect((await runAlertPass(NOW)).fired).toBe(1);
  });

  it('forgets a token the push service says is no longer valid', async () => {
    services({ VNM: 61000 }, 'DeviceNotRegistered');
    await seed([alert('a1', 'VNM', 'above', 60000)]);

    await runAlertPass(NOW);

    expect(await getPrisma().pushToken.findMany({ where: { token: TOKEN } })).toHaveLength(0);
  });

  it('still marks the alert fired when the push service is down: one missed push, not a repeat', async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      if (String(url).includes('exp.host')) throw new Error('unreachable');
      return new Response(
        JSON.stringify({
          symbol: 'VNM',
          source: 'vnstock',
          demo: false,
          as_of: '2026-11-09',
          close: 61000,
          prev_close: 61000,
          change_pct: 0,
          high_52w: 61000,
          low_52w: 61000,
          series: [{ date: '2026-11-09', close: 61000, volume: 1 }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const user = await seed([alert('a1', 'VNM', 'above', 60000)]);

    await runAlertPass(NOW);

    expect((await get(user)).body.data.alerts[0].firedAt).not.toBeNull();
  });
});
