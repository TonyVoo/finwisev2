import type { InvestingAlert, InvestingSettings } from '@expense-tracker/shared';
import { migrate } from '@/db/migrations';
import { META_KEYS, readMeta } from '@/db/meta';
import { addAlert, markFired, readAlerts, removeAlert } from '@/invest/alerts';
import { mergeLists, syncInvesting } from '@/invest/investingSync';
import { unwatch, watch, readWatchlist } from '@/invest/watchlist';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * Keeping the watchlist and price alerts level with the server's copy. The server is faked as the document it
 * keeps, with the same rule it has: a write is applied only against the current version.
 */

class FakeServer {
  doc: InvestingSettings = { watchlist: [], alerts: [], version: 0 };
  puts = 0;
  /** Runs once, between a device's read of the document and its write: another phone getting in first. */
  raceOnce: (() => void) | null = null;

  api = {
    getInvesting: async () => ({ data: structuredClone(this.doc) }),
    putInvesting: async (body: {
      watchlist: string[];
      alerts: InvestingAlert[];
      baseVersion: number;
    }) => {
      this.puts += 1;
      const race = this.raceOnce;
      this.raceOnce = null;
      race?.();
      if (body.baseVersion !== this.doc.version) {
        return { data: structuredClone(this.doc), applied: false };
      }
      this.doc = { watchlist: body.watchlist, alerts: body.alerts, version: this.doc.version + 1 };
      return { data: structuredClone(this.doc), applied: true };
    },
  };
}

const alert = (id: string, symbol = 'VNM', price = 60000): InvestingAlert => ({
  id,
  symbol,
  direction: 'above',
  price,
  firedAt: null,
  firedPrice: null,
});

let database: TestDatabase;
let server: FakeServer;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  server = new FakeServer();
});

describe('first time on an account', () => {
  it("takes the server's lists, never the previous account's", async () => {
    await watch(database, 'VNM'); // someone else's, left on this device
    server.doc = { watchlist: ['FPT'], alerts: [alert('s1', 'FPT')], version: 4 };

    const result = await syncInvesting(server.api, database, 'user-2');

    expect(result).toBe('adopted');
    expect(await readWatchlist(database)).toEqual(['FPT']);
    expect((await readAlerts(database)).map((a) => a.id)).toEqual(['s1']);
    expect(await readMeta(database, META_KEYS.investingOwner)).toBe('user-2');
    expect(await readMeta(database, META_KEYS.investingVersion)).toBe('4');
    expect(server.puts).toBe(0);
  });
});

describe('sending local edits', () => {
  beforeEach(async () => {
    await syncInvesting(server.api, database, 'user-1'); // owner set, nothing to send
  });

  it('sends a change made here against the version last seen, and clears the waiting mark', async () => {
    await watch(database, 'VNM');
    await addAlert(database, 'VNM', 'above', 60000);

    const result = await syncInvesting(server.api, database, 'user-1');

    expect(result).toBe('sent');
    expect(server.doc.watchlist).toEqual(['VNM']);
    expect(server.doc.alerts).toHaveLength(1);
    expect(server.doc.version).toBe(1);
    expect(await readMeta(database, META_KEYS.investingDirty)).toBe('');
    expect(await syncInvesting(server.api, database, 'user-1')).toBe('unchanged');
    expect(server.puts).toBe(1);
  });

  it('sends a removal too', async () => {
    await watch(database, 'VNM');
    await syncInvesting(server.api, database, 'user-1');
    await unwatch(database, 'VNM');

    await syncInvesting(server.api, database, 'user-1');

    expect(server.doc.watchlist).toEqual([]);
    expect(server.doc.version).toBe(2);
  });

  it('merges with a second phone that wrote first, and sends the union once', async () => {
    await watch(database, 'VNM');
    server.raceOnce = () => {
      server.doc = { watchlist: ['FPT'], alerts: [alert('other', 'FPT', 90000)], version: 1 };
    };

    const result = await syncInvesting(server.api, database, 'user-1');

    expect(result).toBe('merged');
    expect(server.doc.watchlist.sort()).toEqual(['FPT', 'VNM']);
    expect(server.doc.alerts.map((a) => a.id)).toEqual(['other']);
    expect(server.doc.version).toBe(2);
    expect(await readWatchlist(database)).toEqual(expect.arrayContaining(['FPT', 'VNM']));
    expect(await readMeta(database, META_KEYS.investingDirty)).toBe('');
  });

  it('gives up for now, still waiting to send, after losing the race twice', async () => {
    await watch(database, 'VNM');
    let n = 0;
    const api = {
      ...server.api,
      putInvesting: async () => {
        n += 1;
        server.doc = { ...server.doc, version: server.doc.version + 1 };
        return { data: structuredClone(server.doc), applied: false };
      },
    };

    expect(await syncInvesting(api, database, 'user-1')).toBe('failed');
    expect(n).toBe(2);
    expect(await readMeta(database, META_KEYS.investingDirty)).toBe('1');
  });
});

describe('taking the server’s changes', () => {
  beforeEach(async () => {
    await syncInvesting(server.api, database, 'user-1');
  });

  it('adopts a newer document when there is nothing to send', async () => {
    server.doc = { watchlist: ['HPG'], alerts: [alert('x', 'HPG')], version: 3 };

    expect(await syncInvesting(server.api, database, 'user-1')).toBe('adopted');

    expect(await readWatchlist(database)).toEqual(['HPG']);
    expect(await readMeta(database, META_KEYS.investingDirty)).not.toBe('1');
    expect(server.puts).toBe(0);
  });

  it('learns an alert fired by the server, so the device does not fire it again', async () => {
    await addAlert(database, 'VNM', 'above', 60000);
    await syncInvesting(server.api, database, 'user-1');
    const sent = server.doc.alerts[0] as InvestingAlert;
    server.doc = {
      ...server.doc,
      alerts: [{ ...sent, firedAt: '2026-11-09T09:00:00.000Z', firedPrice: 61000 }],
      version: server.doc.version + 1,
    };

    await syncInvesting(server.api, database, 'user-1');

    expect((await readAlerts(database))[0]).toMatchObject({ firedAt: '2026-11-09T09:00:00.000Z' });
  });
});

describe('lists made before the server held them', () => {
  it('are sent the first time, though nothing was edited since', async () => {
    await watch(database, 'VNM');
    await database.runAsync('DELETE FROM meta WHERE key = ?', [META_KEYS.investingDirty]);
    await database.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      META_KEYS.investingOwner,
      'user-1',
    ]);

    expect(await syncInvesting(server.api, database, 'user-1')).toBe('sent');
    expect(server.doc.watchlist).toEqual(['VNM']);
  });
});

describe('mergeLists', () => {
  it('keeps the server’s order first, adds what is only local, and keeps a fired alert fired', () => {
    const fired = { ...alert('a'), firedAt: '2026-11-09T09:00:00.000Z', firedPrice: 61000 };
    const merged = mergeLists(
      { watchlist: ['FPT', 'VNM'], alerts: [fired] },
      { watchlist: ['VNM', 'HPG'], alerts: [alert('a'), alert('b', 'HPG')] },
    );
    expect(merged.watchlist).toEqual(['FPT', 'VNM', 'HPG']);
    expect(merged.alerts.map((a) => a.id)).toEqual(['a', 'b']);
    expect(merged.alerts[0]?.firedAt).not.toBeNull();
  });

  it('keeps a local firing the server has not heard of', () => {
    const merged = mergeLists(
      { watchlist: [], alerts: [alert('a')] },
      {
        watchlist: [],
        alerts: [{ ...alert('a'), firedAt: '2026-11-09T09:00:00.000Z', firedPrice: 61000 }],
      },
    );
    expect(merged.alerts[0]?.firedAt).not.toBeNull();
  });
});

describe('what marks a list as waiting to be sent', () => {
  it('every local edit does, including a firing and a removal', async () => {
    await syncInvesting(server.api, database, 'user-1');
    const dirty = async () => (await readMeta(database, META_KEYS.investingDirty)) === '1';

    await addAlert(database, 'VNM', 'above', 60000);
    expect(await dirty()).toBe(true);
    await syncInvesting(server.api, database, 'user-1');
    expect(await dirty()).toBe(false);

    const [a] = await readAlerts(database);
    await markFired(database, [{ id: (a as { id: string }).id, close: 61000 }], new Date());
    expect(await dirty()).toBe(true);
    await syncInvesting(server.api, database, 'user-1');

    await removeAlert(database, (a as { id: string }).id);
    expect(await dirty()).toBe(true);
  });
});
