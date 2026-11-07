import type { Trade } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneTombstones } from '../src/services/tombstoneService.ts';
import { api } from './support/api.ts';
import { createUser, type TestUser } from './support/fixtures.ts';
import { changeFor, pull, pullAll, pushItem, pushOk, resultFor } from './support/sync.ts';

/**
 * Stock trades: a synced entity that is **private to its author**. What the server owns is storage,
 * validation, last-write-wins, the tombstone, and above all who may see a row: in a household's shared
 * book only the person who entered a trade is ever sent it, and it goes home with them when they leave.
 */

const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-01T11:00:00.000Z';
const T2 = '2026-11-01T12:00:00.000Z';

function tradeItem(
  fields: Record<string, unknown> = {},
  extra: { id?: string; updatedAt?: string } = {},
) {
  return pushItem({
    entity: 'trade',
    id: extra.id ?? uuidv7(),
    ...(extra.updatedAt === undefined ? {} : { updatedAt: extra.updatedAt }),
    fields: {
      symbol: 'VNM',
      side: 'buy',
      quantity: 100,
      price: 56800,
      fee: 8520,
      date: '2026-11-04',
      ...fields,
    },
  } as never);
}

async function householdOfTwo(): Promise<{ owner: TestUser; member: TestUser }> {
  const owner = await createUser();
  const member = await createUser();
  await api().post('/v1/household').set('Authorization', owner.auth).send({});
  const invite = await api().post('/v1/household/invite').set('Authorization', owner.auth).send({});
  await api()
    .post('/v1/household/join')
    .set('Authorization', member.auth)
    .send({ code: invite.body.data.code });
  return { owner, member };
}

const tradeIds = (changes: Awaited<ReturnType<typeof pullAll>>['changes']) =>
  changes.filter((c) => c.entity === 'trade').map((c) => c.record.id);

describe('creating a trade through sync', () => {
  it('stores it with whole-dong money, defaults the fee to zero and trims the note', async () => {
    const user = await createUser();
    const item = tradeItem({ fee: undefined, note: '  FOMO  ' }, { updatedAt: T0 });

    const [result] = await pushOk(user, [item]);

    expect(result).toMatchObject({ entity: 'trade', status: 'applied', error: null });
    expect(result!.record).toMatchObject({
      id: item.id,
      symbol: 'VNM',
      side: 'buy',
      quantity: 100,
      price: 56800,
      fee: 0,
      date: '2026-11-04',
      note: 'FOMO',
      deletedAt: null,
    });
    // Nothing about who owns it goes on the wire.
    expect(Object.keys(result!.record as object)).not.toContain('createdBy');
    expect(Object.keys(result!.record as object)).not.toContain('userId');
  });

  it('stores a note that trims to nothing as null', async () => {
    const user = await createUser();
    const [result] = await pushOk(user, [tradeItem({ note: '   ' })]);
    expect((result!.record as Trade).note).toBeNull();
  });

  it('reports every missing field in one go', async () => {
    const user = await createUser();
    const item = pushItem({ entity: 'trade', id: uuidv7(), fields: { fee: 5 } } as never);

    const [result] = await pushOk(user, [item]);

    expect(result!.status).toBe('invalid');
    const paths = (result!.error?.details as { issues: { path: string }[] }).issues.map(
      (i) => i.path,
    );
    expect(paths.sort()).toEqual([
      'fields.date',
      'fields.price',
      'fields.quantity',
      'fields.side',
      'fields.symbol',
    ]);
  });

  it.each([
    ['a fractional price', { price: 56800.5 }],
    ['a zero quantity', { quantity: 0 }],
    ['an unknown side', { side: 'hold' }],
    ['a lower-case symbol', { symbol: 'vnm' }],
    ['a negative fee', { fee: -1 }],
  ])('refuses %s as an invalid record, not a failed batch', async (_name, bad) => {
    const user = await createUser();
    const good = tradeItem();

    const results = await pushOk(user, [tradeItem(bad), good]);

    expect(results[0]!.status).toBe('invalid');
    expect(resultFor(results, good.id).status).toBe('applied');
  });
});

describe('dividends', () => {
  it('is a kind of trade: shares paid on, per share, tax withheld in the fee', async () => {
    const user = await createUser();
    const item = tradeItem({ side: 'dividend', quantity: 100, price: 2000, fee: 20000 });

    const [result] = await pushOk(user, [item]);

    expect(result).toMatchObject({ status: 'applied', error: null });
    expect(result!.record).toMatchObject({
      side: 'dividend',
      quantity: 100,
      price: 2000,
      fee: 20000,
    });
    const pulled = (await pullAll(user)).changes.find((c) => c.record.id === item.id);
    expect((pulled?.record as Trade).side).toBe('dividend');
  });

  it('still refuses a side that is not one of the three', async () => {
    const user = await createUser();
    const [result] = await pushOk(user, [tradeItem({ side: 'gift' })]);
    expect(result!.status).toBe('invalid');
  });
});

describe('changing a trade', () => {
  it('merges fields, and a later edit wins over an earlier one', async () => {
    const user = await createUser();
    const item = tradeItem({}, { updatedAt: T0 });
    await pushOk(user, [item]);

    const [result] = await pushOk(user, [
      pushItem({
        entity: 'trade',
        id: item.id,
        updatedAt: T1,
        fields: { quantity: 300 },
      } as never),
    ]);

    expect(result!.status).toBe('applied');
    expect(result!.record).toMatchObject({ quantity: 300, price: 56800, symbol: 'VNM' });
  });

  it('keeps the newer edit when an older one arrives late', async () => {
    const user = await createUser();
    const item = tradeItem({}, { updatedAt: T1 });
    await pushOk(user, [item]);

    const [result] = await pushOk(user, [
      pushItem({
        entity: 'trade',
        id: item.id,
        updatedAt: T0,
        fields: { quantity: 999 },
      } as never),
    ]);

    expect(result!.status).toBe('conflict_server_wins');
    expect((result!.record as Trade).quantity).toBe(100);
  });

  it('deletes by tombstone, and the tombstone reaches a later pull', async () => {
    const user = await createUser();
    const item = tradeItem({}, { updatedAt: T0 });
    await pushOk(user, [item]);
    await pushOk(user, [
      pushItem({
        entity: 'trade',
        id: item.id,
        updatedAt: T1,
        fields: { deletedAt: T1 },
      } as never),
    ]);

    const { changes } = await pullAll(user);

    const change = changeFor(changes, item.id);
    expect(change?.entity).toBe('trade');
    expect(change?.record.deletedAt).toBe(T1);
  });

  it('replays a retried mutation without applying it twice', async () => {
    const user = await createUser();
    const clientMutationId = uuidv7();
    const item = tradeItem({}, { updatedAt: T0 });
    const same = { ...item, clientMutationId };

    const first = await pushOk(user, [same]);
    const second = await pushOk(user, [same]);

    expect(first[0]!.idempotentReplay).toBe(false);
    expect(second[0]!.idempotentReplay).toBe(true);
    expect(second[0]!.record).toEqual(first[0]!.record);
  });
});

describe('pulling trades', () => {
  it('delivers a trade to the account that entered it, in revision order with the rest', async () => {
    const user = await createUser();
    const item = tradeItem({}, { updatedAt: T0 });
    await pushOk(user, [item]);

    const { changes } = await pullAll(user);

    expect(tradeIds(changes)).toEqual([item.id]);
  });

  it('never delivers one account a trade of another', async () => {
    const [a, b] = [await createUser(), await createUser()];
    await pushOk(a, [tradeItem()]);

    expect(tradeIds((await pullAll(b)).changes)).toEqual([]);
  });
});

describe('in a household: private to the author', () => {
  it('does not send a member the owner’s trade, nor the owner the member’s', async () => {
    const { owner, member } = await householdOfTwo();
    const ownerTrade = tradeItem({ symbol: 'FPT' });
    const memberTrade = tradeItem({ symbol: 'VNM' });
    await pushOk(owner, [ownerTrade]);
    await pushOk(member, [memberTrade]);

    expect(tradeIds((await pullAll(owner)).changes)).toEqual([ownerTrade.id]);
    expect(tradeIds((await pullAll(member)).changes)).toEqual([memberTrade.id]);
  });

  it('answers another member’s trade id as an id already in use, and changes nothing', async () => {
    const { owner, member } = await householdOfTwo();
    const secret = tradeItem({}, { updatedAt: T0 });
    await pushOk(member, [secret]);

    const [result] = await pushOk(owner, [
      pushItem({
        entity: 'trade',
        id: secret.id,
        updatedAt: T2,
        fields: { quantity: 1, deletedAt: T2 },
      } as never),
    ]);

    expect(result!.status).toBe('invalid');
    // And it does not even confirm the row exists: no record comes back.
    expect(result!.record).toBeNull();
    const mine = (await pullAll(member)).changes.find((c) => c.record.id === secret.id);
    expect(mine?.record).toMatchObject({ quantity: 100, deletedAt: null });
  });

  it('keeps the revision stream coherent for a member who sees none of the other’s trades', async () => {
    const { owner, member } = await householdOfTwo();
    await pushOk(owner, [tradeItem(), tradeItem(), tradeItem()]);
    const mine = tradeItem({ symbol: 'HPG' });
    await pushOk(member, [mine]);

    const page = await pull(member, { since: 0, limit: 1 });

    // Paging with a tiny limit still reaches the member's own row.
    const all = await pullAll(member, { limit: 1 });
    expect(tradeIds(all.changes)).toEqual([mine.id]);
    expect(page.resyncRequired).toBe(false);
  });

  it('hands a member’s trades back to their own account when they leave', async () => {
    const { owner, member } = await householdOfTwo();
    const mine = tradeItem({ symbol: 'HPG' });
    const theirs = tradeItem({ symbol: 'FPT' });
    await pushOk(member, [mine]);
    await pushOk(owner, [theirs]);

    const left = await api().post('/v1/household/leave').set('Authorization', member.auth).send({});
    expect(left.status).toBe(204);

    const memberAfter = await pullAll(member);
    expect(tradeIds(memberAfter.changes)).toEqual([mine.id]);
    // Still the owner's alone, in the household's book.
    expect(tradeIds((await pullAll(owner)).changes)).toEqual([theirs.id]);
    const row = await getPrisma().trade.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.userId).toBe(member.user.id);
    expect(row.createdBy).toBe(member.user.id);
  });

  it('gives each person their trades back when the household is deleted', async () => {
    const { owner, member } = await householdOfTwo();
    const mine = tradeItem({ symbol: 'HPG' });
    const theirs = tradeItem({ symbol: 'FPT' });
    await pushOk(member, [mine]);
    await pushOk(owner, [theirs]);

    const deleted = await api().delete('/v1/household').set('Authorization', owner.auth);
    expect(deleted.status).toBe(204);

    expect(tradeIds((await pullAll(member)).changes)).toEqual([mine.id]);
    expect(tradeIds((await pullAll(owner)).changes)).toEqual([theirs.id]);
  });
});

describe('pruning', () => {
  it('collects an expired trade tombstone and moves the watermark past it', async () => {
    const user = await createUser();
    const item = tradeItem({}, { updatedAt: T0 });
    await pushOk(user, [item]);
    await pushOk(user, [
      pushItem({
        entity: 'trade',
        id: item.id,
        updatedAt: T1,
        fields: { deletedAt: '2026-07-01T00:00:00.000Z' },
      } as never),
    ]);

    const result = await pruneTombstones(
      getPrisma(),
      user.user.id,
      new Date('2026-11-06T00:00:00Z'),
    );

    expect(result.trades).toBe(1);
    expect(await getPrisma().trade.count({ where: { id: item.id } })).toBe(0);
    expect(result.prunedThroughRevision).toBeGreaterThan(0);
  });
});
