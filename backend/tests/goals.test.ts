import { type Goal } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneTombstones } from '../src/services/tombstoneService.ts';
import { createUser } from './support/fixtures.ts';
import { pull, pushItem, pushOk, resultFor } from './support/sync.ts';

/**
 * Savings goals: a fourth synced entity. Progress is manual, so what the server owns is
 * storage, validation, last-write-wins on `savedMinor`, and the tombstone.
 */

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T11:00:00.000Z';
const T2 = '2026-10-01T12:00:00.000Z';

function goalItem(
  fields: Record<string, unknown> = {},
  extra: { id?: string; updatedAt?: string } = {},
) {
  return pushItem({
    entity: 'goal',
    id: extra.id ?? uuidv7(),
    ...(extra.updatedAt === undefined ? {} : { updatedAt: extra.updatedAt }),
    fields: { name: ' Holiday ', targetMinor: 100000, ...fields },
  } as never);
}

describe('creating a goal through sync', () => {
  it('stores it, trims the name, defaults saved to zero and the currency to the account', async () => {
    const user = await createUser();
    const item = goalItem({}, { updatedAt: T0 });

    const [result] = await pushOk(user, [item]);

    expect(result).toMatchObject({ entity: 'goal', status: 'applied', error: null });
    expect(result!.record).toMatchObject({
      id: item.id,
      name: 'Holiday',
      targetMinor: 100000,
      savedMinor: 0,
      deadline: null,
      deletedAt: null,
    });
    expect((result!.record as Goal).currency).toBe(user.user.currency);
  });

  it('reports every missing field in one go', async () => {
    const user = await createUser();
    const item = pushItem({ entity: 'goal', id: uuidv7(), fields: { savedMinor: 5 } } as never);

    const [result] = await pushOk(user, [item]);

    expect(result!.status).toBe('invalid');
    const paths = (result!.error?.details as { issues: { path: string }[] }).issues.map(
      (i) => i.path,
    );
    expect(paths.sort()).toEqual(['fields.name', 'fields.targetMinor']);
  });

  it.each([
    ['a zero target', { targetMinor: 0 }],
    ['a negative saved amount', { savedMinor: -1 }],
    ['a fractional target', { targetMinor: 10.5 }],
    ['an empty name', { name: '   ' }],
    ['a malformed deadline', { deadline: '2026-13-01' }],
  ])('rejects %s without touching the rest of the batch', async (_label, bad) => {
    const user = await createUser();
    const good = goalItem();
    const broken = goalItem(bad);

    const results = await pushOk(user, [broken, good]);

    expect(resultFor(results, broken.id).status).toBe('invalid');
    expect(resultFor(results, good.id).status).toBe('applied');
    expect(await getPrisma().goal.count({ where: { id: broken.id } })).toBe(0);
  });
});

describe('updating a goal', () => {
  it('merges a deposit into the stored row', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [goalItem({ deadline: '2027-01-01' }, { id, updatedAt: T0 })]);

    const [result] = await pushOk(user, [
      pushItem({ entity: 'goal', id, updatedAt: T1, fields: { savedMinor: 25000 } } as never),
    ]);

    expect(result!.status).toBe('applied');
    expect(result!.record).toMatchObject({
      name: 'Holiday',
      targetMinor: 100000,
      savedMinor: 25000,
      deadline: '2027-01-01',
    });
  });

  it('lets the later write win and answers conflict to the earlier one', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [goalItem({}, { id, updatedAt: T1 })]);

    const [stale] = await pushOk(user, [
      pushItem({ entity: 'goal', id, updatedAt: T0, fields: { savedMinor: 1 } } as never),
    ]);
    expect(stale!.status).toBe('conflict_server_wins');
    expect((stale!.record as Goal).savedMinor).toBe(0);

    const [fresh] = await pushOk(user, [
      pushItem({ entity: 'goal', id, updatedAt: T2, fields: { savedMinor: 9 } } as never),
    ]);
    expect(fresh!.status).toBe('applied');
  });

  it('clears a deadline with null', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [goalItem({ deadline: '2027-01-01' }, { id, updatedAt: T0 })]);

    const [result] = await pushOk(user, [
      pushItem({ entity: 'goal', id, updatedAt: T1, fields: { deadline: null } } as never),
    ]);

    expect((result!.record as Goal).deadline).toBeNull();
  });
});

describe('another account', () => {
  it('cannot read or overwrite a goal it does not own', async () => {
    const owner = await createUser();
    const other = await createUser();
    const id = uuidv7();
    await pushOk(owner, [goalItem({}, { id, updatedAt: T0 })]);

    const [result] = await pushOk(other, [
      pushItem({ entity: 'goal', id, updatedAt: T1, fields: { savedMinor: 5 } } as never),
    ]);

    expect(result!.status).toBe('invalid');
    const page = await pull(other, { since: 0 });
    expect(page.changes.some((c) => c.entity === 'goal')).toBe(false);
  });
});

describe('deleting a goal', () => {
  it('delivers a tombstone through pull, and prunes it past the horizon', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [goalItem({}, { id, updatedAt: T0 })]);
    await pushOk(user, [
      pushItem({
        entity: 'goal',
        id,
        updatedAt: T1,
        fields: { deletedAt: T1 },
      } as never),
    ]);

    const page = await pull(user, { since: 0 });
    const change = page.changes.find((c) => c.entity === 'goal');
    expect((change!.record as Goal).deletedAt).not.toBeNull();

    const later = new Date(Date.now() + 91 * 24 * 3600 * 1000);
    const result = await pruneTombstones(getPrisma(), user.user.id, later);

    expect(result.goals).toBe(1);
    expect(await getPrisma().goal.count({ where: { id } })).toBe(0);
  });
});
