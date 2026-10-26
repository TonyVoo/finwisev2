import { type RecurringRule } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneTombstones } from '../src/services/tombstoneService.ts';
import { api } from './support/api.ts';
import { createUser } from './support/fixtures.ts';
import { pull, pushItem, pushOk, resultFor } from './support/sync.ts';

/**
 * Recurring rules: a third synced entity. A rule has no "next date" and the server never
 * generates expenses; what the server owns is the rule's storage, validation, LWW and
 * tombstone, so that is what is tested here. The occurrence arithmetic is the device's
 * and is tested in the mobile suite.
 */

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T11:00:00.000Z';
const T2 = '2026-10-01T12:00:00.000Z';

function ruleItem(
  user: { categories: Record<string, { id: string }> },
  fields: Record<string, unknown> = {},
  extra: { id?: string; updatedAt?: string } = {},
) {
  return pushItem({
    entity: 'recurring',
    id: extra.id ?? uuidv7(),
    ...(extra.updatedAt === undefined ? {} : { updatedAt: extra.updatedAt }),
    fields: {
      categoryId: user.categories['Bills']!.id,
      amountMinor: 1299,
      frequency: 'monthly',
      startDate: '2026-10-31',
      ...fields,
    },
  } as never);
}

describe('creating a rule through sync', () => {
  it('stores it, defaults the currency to the account currency, and reports the row', async () => {
    const user = await createUser();
    const item = ruleItem(user, { note: ' Netflix ' }, { updatedAt: T0 });

    const [result] = await pushOk(user, [item]);

    expect(result).toMatchObject({ entity: 'recurring', status: 'applied', error: null });
    expect(result!.record).toMatchObject({
      id: item.id,
      amountMinor: 1299,
      frequency: 'monthly',
      startDate: '2026-10-31',
      endDate: null,
      note: 'Netflix',
      deletedAt: null,
    });
    expect((result!.record as RecurringRule).currency).toBe(user.user.currency);
  });

  it('reports every missing field in one go', async () => {
    const user = await createUser();
    const item = pushItem({
      entity: 'recurring',
      id: uuidv7(),
      fields: { note: 'x' },
    } as never);

    const [result] = await pushOk(user, [item]);

    expect(result!.status).toBe('invalid');
    expect(result!.error?.code).toBe('validation_error');
    const paths = (result!.error?.details as { issues: { path: string }[] }).issues.map(
      (i) => i.path,
    );
    expect(paths.sort()).toEqual([
      'fields.amountMinor',
      'fields.categoryId',
      'fields.frequency',
      'fields.startDate',
    ]);
  });

  it.each([
    ['an unknown frequency', { frequency: 'daily' }],
    ['a malformed start date', { startDate: '2026-13-01' }],
    ['a negative amount', { amountMinor: -1 }],
    ['a fractional amount', { amountMinor: 12.5 }],
  ])('rejects %s without touching the other items in the batch', async (_label, bad) => {
    const user = await createUser();
    const good = ruleItem(user);
    const broken = ruleItem(user, bad);

    const results = await pushOk(user, [broken, good]);

    expect(resultFor(results, broken.id).status).toBe('invalid');
    expect(resultFor(results, good.id).status).toBe('applied');
    expect(await getPrisma().recurringRule.count({ where: { id: broken.id } })).toBe(0);
  });

  it('refuses an end date before the start date', async () => {
    const user = await createUser();
    const item = ruleItem(user, { startDate: '2026-10-10', endDate: '2026-10-09' });

    const [result] = await pushOk(user, [item]);

    expect(result!.status).toBe('invalid');
    expect(result!.error?.code).toBe('validation_error');
  });

  it('allows an end date equal to the start date (a rule that fires once)', async () => {
    const user = await createUser();
    const [result] = await pushOk(user, [
      ruleItem(user, { startDate: '2026-10-10', endDate: '2026-10-10' }),
    ]);
    expect(result!.status).toBe('applied');
  });

  it("refuses another account's category, as unknown_category", async () => {
    const owner = await createUser();
    const other = await createUser();

    const [result] = await pushOk(owner, [
      ruleItem(owner, { categoryId: other.categories['Bills']!.id }),
    ]);

    expect(result!.status).toBe('invalid');
    expect(result!.error?.code).toBe('unknown_category');
  });

  it("refuses an id that already belongs to another account's rule", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const item = ruleItem(owner);
    await pushOk(owner, [item]);

    const [result] = await pushOk(intruder, [
      ruleItem(intruder, { amountMinor: 1 }, { id: item.id, updatedAt: T2 }),
    ]);

    expect(result!.status).toBe('invalid');
    expect(result!.record).toBeNull();
    const stored = await getPrisma().recurringRule.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.userId).toBe(owner.user.id);
    expect(Number(stored.amountMinor)).toBe(1299);
  });
});

describe('updating a rule', () => {
  it('merges: absent keys are left alone, null clears the note and the end date', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [
      ruleItem(user, { note: 'Gym', endDate: '2027-01-31' }, { id, updatedAt: T0 }),
    ]);

    const [amount] = await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T1, fields: { amountMinor: 2000 } }),
    ]);
    expect(amount!.record).toMatchObject({
      amountMinor: 2000,
      note: 'Gym',
      endDate: '2027-01-31',
      frequency: 'monthly',
    });

    const [cleared] = await pushOk(user, [
      pushItem({
        entity: 'recurring',
        id,
        updatedAt: T2,
        fields: { note: null, endDate: null },
      }),
    ]);
    expect(cleared!.record).toMatchObject({ note: null, endDate: null, amountMinor: 2000 });
  });

  it('judges a lone endDate against the stored startDate', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [ruleItem(user, { startDate: '2026-10-10' }, { id, updatedAt: T0 })]);

    const [result] = await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T1, fields: { endDate: '2026-10-01' } }),
    ]);

    expect(result!.status).toBe('invalid');
    const stored = await getPrisma().recurringRule.findUniqueOrThrow({ where: { id } });
    expect(stored.endDate).toBeNull();
  });

  it('lets an unrelated edit through after its category was deleted', async () => {
    const user = await createUser();
    const id = uuidv7();
    const bills = user.categories['Bills']!.id;
    await pushOk(user, [ruleItem(user, {}, { id, updatedAt: T0 })]);

    const deleted = await api().delete(`/v1/categories/${bills}`).set('Authorization', user.auth);
    expect(deleted.status).toBeLessThan(300);

    const [result] = await pushOk(user, [
      pushItem({
        entity: 'recurring',
        id,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
        fields: { amountMinor: 5 },
      }),
    ]);
    expect(result!.status).toBe('applied');
    // Not reassigned: the device falls back to the default itself.
    expect((result!.record as RecurringRule).categoryId).toBe(bills);
  });

  it('but refuses to point a live rule at a deleted category', async () => {
    const user = await createUser();
    const id = uuidv7();
    const health = user.categories['Health']!.id;
    await pushOk(user, [ruleItem(user, {}, { id, updatedAt: T0 })]);
    await api().delete(`/v1/categories/${health}`).set('Authorization', user.auth);

    const [result] = await pushOk(user, [
      pushItem({
        entity: 'recurring',
        id,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
        fields: { categoryId: health },
      }),
    ]);
    expect(result!.status).toBe('invalid');
    expect(result!.error?.code).toBe('unknown_category');
  });

  it('last write wins, and the loser gets the authoritative row back', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [ruleItem(user, { amountMinor: 100 }, { id, updatedAt: T2 })]);

    const [stale] = await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T1, fields: { amountMinor: 999 } }),
    ]);

    expect(stale!.status).toBe('conflict_server_wins');
    expect((stale!.record as RecurringRule).amountMinor).toBe(100);
  });

  it('replays an identical mutation instead of applying it twice', async () => {
    const user = await createUser();
    const item = ruleItem(user, {}, { updatedAt: T0 });

    const [first] = await pushOk(user, [item]);
    const [second] = await pushOk(user, [item]);

    expect(first!.idempotentReplay).toBe(false);
    expect(second).toMatchObject({ status: 'applied', idempotentReplay: true });
    expect(await getPrisma().recurringRule.count({ where: { userId: user.user.id } })).toBe(1);
  });
});

describe('deleting a rule', () => {
  it('is a tombstone that reaches a second device through pull', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [ruleItem(user, {}, { id, updatedAt: T0 })]);
    await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T1, fields: { deletedAt: T1 } }),
    ]);

    const page = await pull(user, { since: 0 });
    const change = page.changes.find((c) => c.record.id === id);

    expect(change?.entity).toBe('recurring');
    expect(change?.record.deletedAt).toBe(T1);
  });

  it('can be undeleted by a later write', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [ruleItem(user, {}, { id, updatedAt: T0 })]);
    await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T1, fields: { deletedAt: T1 } }),
    ]);
    const [undeleted] = await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T2, fields: { deletedAt: null } }),
    ]);
    expect((undeleted!.record as RecurringRule).deletedAt).toBeNull();
  });

  it('is pruned after the tombstone horizon and moves the resync watermark', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [ruleItem(user, {}, { id, updatedAt: T0 })]);
    await pushOk(user, [
      pushItem({ entity: 'recurring', id, updatedAt: T1, fields: { deletedAt: T1 } }),
    ]);

    const live = ruleItem(user, {}, { updatedAt: T0 });
    await pushOk(user, [live]);

    const later = new Date(Date.now() + 91 * 24 * 3600 * 1000);
    const result = await pruneTombstones(getPrisma(), user.user.id, later);

    expect(result.recurring).toBe(1);
    expect(await getPrisma().recurringRule.count({ where: { id } })).toBe(0);
    // A live rule is never pruned, however old.
    expect(await getPrisma().recurringRule.count({ where: { id: live.id } })).toBe(1);
    expect(result.prunedThroughRevision).toBeGreaterThan(0);
  });
});

describe('pull', () => {
  it('delivers categories, rules and expenses in one revision order', async () => {
    const user = await createUser();
    const id = uuidv7();
    await pushOk(user, [ruleItem(user, {}, { id })]);

    const page = await pull(user, { since: 0 });
    const revisions = page.changes.map((c) => c.record.revision);

    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(page.changes.some((c) => c.entity === 'recurring' && c.record.id === id)).toBe(true);
  });

  it("never shows one account another's rules", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const item = ruleItem(alice);
    await pushOk(alice, [item]);

    const page = await pull(bob, { since: 0 });
    expect(page.changes.some((c) => c.record.id === item.id)).toBe(false);
  });
});

describe('account deletion', () => {
  it('removes the rules with the account', async () => {
    const user = await createUser();
    const item = ruleItem(user);
    await pushOk(user, [item]);

    const res = await api()
      .delete('/v1/me')
      .set('Authorization', user.auth)
      .send({ password: user.password });
    expect(res.status).toBeLessThan(300);

    expect(await getPrisma().recurringRule.count({ where: { id: item.id } })).toBe(0);
  });
});
