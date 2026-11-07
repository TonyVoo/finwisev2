import { META_KEYS, WIPED_META_KEYS, writeMeta } from '@/db/meta';
import { migrate } from '@/db/migrations';
import { MAX_WATCHED, readWatchlist, unwatch, watch } from '@/invest/watchlist';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

describe('watchlist', () => {
  it('starts empty', async () => {
    expect(await readWatchlist(database)).toEqual([]);
  });

  it('adds symbols newest first, upper-cased', async () => {
    await watch(database, 'vnm');
    expect(await watch(database, ' fpt ')).toEqual(['FPT', 'VNM']);
    expect(await readWatchlist(database)).toEqual(['FPT', 'VNM']);
  });

  it('moves a symbol already watched to the front instead of repeating it', async () => {
    await watch(database, 'VNM');
    await watch(database, 'FPT');
    expect(await watch(database, 'vnm')).toEqual(['VNM', 'FPT']);
  });

  it('ignores something that is not a ticker', async () => {
    await watch(database, 'VNM');
    expect(await watch(database, 'a-b')).toEqual(['VNM']);
  });

  it('removes one', async () => {
    await watch(database, 'VNM');
    await watch(database, 'FPT');
    expect(await unwatch(database, 'vnm')).toEqual(['FPT']);
  });

  it('keeps the newest twenty', async () => {
    for (let i = 0; i < MAX_WATCHED + 3; i += 1) await watch(database, `S${i}`);
    const list = await readWatchlist(database);
    expect(list).toHaveLength(MAX_WATCHED);
    expect(list[0]).toBe(`S${MAX_WATCHED + 2}`);
  });

  it('reads damaged storage as empty, and keeps only valid tickers from a half-good list', async () => {
    await writeMeta(database, META_KEYS.watchlist, '{not json');
    expect(await readWatchlist(database)).toEqual([]);
    await writeMeta(
      database,
      META_KEYS.watchlist,
      JSON.stringify(['VNM', 1, null, 'bad one', 'VNM']),
    );
    expect(await readWatchlist(database)).toEqual(['VNM']);
  });

  it('survives a scope switch: it is a device preference, not account data', () => {
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.watchlist);
  });
});
