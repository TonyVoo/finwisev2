import { type Settlement } from '@expense-tracker/shared';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { getPrisma } from '../src/db/client.ts';
import { pruneTombstones } from '../src/services/tombstoneService.ts';
import { api } from './support/api.ts';
import { createUser, type TestUser } from './support/fixtures.ts';
import { pull, pushItem, pushOk } from './support/sync.ts';

/**
 * Settlements (`docs/design/12-settle-up.md`): recorded payments between two members of a
 * household. Sync-only, in the household's book, so every member sees every payment. What the
 * server enforces is who may write one: a household member, between two current members, who is
 * one of the two, and the same to edit or delete.
 */

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T11:00:00.000Z';
const T2 = '2026-10-01T12:00:00.000Z';

async function join(owner: TestUser, member: TestUser): Promise<void> {
  const invite = await api().post('/v1/household/invite').set('Authorization', owner.auth).send({});
  const joined = await api()
    .post('/v1/household/join')
    .set('Authorization', member.auth)
    .send({ code: invite.body.data.code });
  expect(joined.status).toBe(200);
}

async function householdOfTwo() {
  const owner = await createUser();
  const member = await createUser();
  await api().post('/v1/household').set('Authorization', owner.auth).send({});
  await join(owner, member);
  return { owner, member };
}

async function householdOfThree() {
  const { owner, member } = await householdOfTwo();
  const third = await createUser();
  await join(owner, third);
  return { owner, member, third };
}

const idOf = (user: TestUser) => user.user.id;

function settlementItem(
  fields: Record<string, unknown>,
  extra: { id?: string; updatedAt?: string } = {},
) {
  return pushItem({
    entity: 'settlement',
    id: extra.id ?? uuidv7(),
    ...(extra.updatedAt === undefined ? {} : { updatedAt: extra.updatedAt }),
    fields,
  } as never);
}

/** A complete create: `from` paid `to`. */
function payment(from: TestUser, to: TestUser, overrides: Record<string, unknown> = {}) {
  return {
    fromUserId: idOf(from),
    toUserId: idOf(to),
    amountMinor: 4200,
    date: '2026-10-06',
    ...overrides,
  };
}

async function settlementsSeenBy(user: TestUser): Promise<Settlement[]> {
  const page = await pull(user, { since: 0 });
  return page.changes
    .filter((change) => change.entity === 'settlement')
    .map((change) => change.record as Settlement);
}

describe('recording a payment', () => {
  it('stores it in the household book, with the person who recorded it', async () => {
    const { owner, member } = await householdOfTwo();
    const item = settlementItem(payment(member, owner, { note: ' cash ' }), { updatedAt: T0 });

    const [result] = await pushOk(member, [item]);

    expect(result).toMatchObject({ entity: 'settlement', status: 'applied', error: null });
    expect(result!.record).toMatchObject({
      id: item.id,
      fromUserId: idOf(member),
      toUserId: idOf(owner),
      amountMinor: 4200,
      date: '2026-10-06',
      note: 'cash',
      createdBy: idOf(member),
      deletedAt: null,
    });
  });

  it('is seen by every member, not only the two it names', async () => {
    const { owner, member, third } = await householdOfThree();
    const item = settlementItem(payment(member, owner), { updatedAt: T0 });
    await pushOk(member, [item]);

    for (const who of [owner, member, third]) {
      const seen = await settlementsSeenBy(who);
      expect(seen.map((s) => s.id)).toEqual([item.id]);
    }
  });

  it('lets either side record it', async () => {
    const { owner, member } = await householdOfTwo();

    const [paid] = await pushOk(member, [settlementItem(payment(member, owner))]);
    const [confirmed] = await pushOk(owner, [settlementItem(payment(member, owner))]);

    expect(paid).toMatchObject({ status: 'applied' });
    expect(confirmed).toMatchObject({ status: 'applied' });
    expect((confirmed!.record as Settlement).createdBy).toBe(idOf(owner));
  });

  it('refuses a payment between two other people', async () => {
    const { owner, member, third } = await householdOfThree();

    const [result] = await pushOk(third, [settlementItem(payment(owner, member))]);

    expect(result).toMatchObject({ status: 'invalid' });
    expect(await getPrisma().settlement.count()).toBe(0);
  });

  it('refuses a payment to oneself', async () => {
    const { owner } = await householdOfTwo();

    const [result] = await pushOk(owner, [settlementItem(payment(owner, owner))]);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('refuses someone who is not in the household', async () => {
    const { owner } = await householdOfTwo();
    const stranger = await createUser();

    const [asPayee] = await pushOk(owner, [settlementItem(payment(owner, stranger))]);
    const [asPayer] = await pushOk(owner, [settlementItem(payment(stranger, owner))]);

    expect(asPayee).toMatchObject({ status: 'invalid' });
    expect(asPayer).toMatchObject({ status: 'invalid' });
    expect(await getPrisma().settlement.count()).toBe(0);
  });

  it('is not available to an account with no household', async () => {
    const solo = await createUser();
    const other = await createUser();

    const [result] = await pushOk(solo, [settlementItem(payment(solo, other))]);

    expect(result).toMatchObject({ status: 'invalid' });
    expect(await getPrisma().settlement.count()).toBe(0);
  });

  it('names every field a new payment is missing', async () => {
    const { owner } = await householdOfTwo();

    const [result] = await pushOk(owner, [settlementItem({ note: 'x' })]);

    expect(result).toMatchObject({ status: 'invalid' });
    const text = JSON.stringify(result!.error);
    for (const field of ['fromUserId', 'toUserId', 'amountMinor', 'date']) {
      expect(text).toContain(field);
    }
  });

  it.each([0, -5, 1.5])('refuses an amount of %s', async (amountMinor) => {
    const { owner, member } = await householdOfTwo();

    const [result] = await pushOk(owner, [settlementItem(payment(owner, member, { amountMinor }))]);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('stores a note that trims to nothing as null', async () => {
    const { owner, member } = await householdOfTwo();

    const [result] = await pushOk(owner, [settlementItem(payment(owner, member, { note: '   ' }))]);

    expect((result!.record as Settlement).note).toBeNull();
  });

  it('refuses a field the server owns', async () => {
    const { owner, member } = await householdOfTwo();

    const [result] = await pushOk(owner, [
      settlementItem(payment(owner, member, { createdBy: idOf(member) })),
    ]);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('refuses an id that already belongs to another book', async () => {
    const { owner, member } = await householdOfTwo();
    const { owner: otherOwner, member: otherMember } = await householdOfTwo();
    const item = settlementItem(payment(owner, member));
    await pushOk(owner, [item]);

    const [result] = await pushOk(otherOwner, [
      settlementItem(payment(otherOwner, otherMember), { id: item.id }),
    ]);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('replays a retried push without recording it twice', async () => {
    const { owner, member } = await householdOfTwo();
    const item = settlementItem(payment(owner, member), { updatedAt: T0 });

    const [first] = await pushOk(owner, [item]);
    const [second] = await pushOk(owner, [item]);

    expect(second).toMatchObject({ status: first!.status, idempotentReplay: true });
    expect(await getPrisma().settlement.count()).toBe(1);
  });
});

describe('changing and undoing a payment', () => {
  async function recorded() {
    const trio = await householdOfThree();
    const item = settlementItem(payment(trio.member, trio.owner), { updatedAt: T0 });
    await pushOk(trio.member, [item]);
    return { ...trio, id: item.id };
  }

  const edit = (id: string, fields: Record<string, unknown>, updatedAt = T1) =>
    settlementItem(fields, { id, updatedAt });

  it('lets either named person correct the amount', async () => {
    const { owner, member, id } = await recorded();

    const [byPayee] = await pushOk(owner, [edit(id, { amountMinor: 5000 }, T1)]);
    const [byPayer] = await pushOk(member, [edit(id, { amountMinor: 6000 }, T2)]);

    expect(byPayee).toMatchObject({ status: 'applied' });
    expect(byPayer).toMatchObject({ status: 'applied' });
    expect(((await settlementsSeenBy(owner))[0] as Settlement).amountMinor).toBe(6000);
  });

  it('keeps who recorded it when someone else edits it', async () => {
    const { owner, id, member } = await recorded();

    const [result] = await pushOk(owner, [edit(id, { amountMinor: 5000 })]);

    expect((result!.record as Settlement).createdBy).toBe(idOf(member));
  });

  it('refuses a member the payment does not name', async () => {
    const { third, id } = await recorded();

    const [amount] = await pushOk(third, [edit(id, { amountMinor: 1 })]);
    const [remove] = await pushOk(third, [edit(id, { deletedAt: T1 })]);

    expect(amount).toMatchObject({ status: 'invalid' });
    expect(remove).toMatchObject({ status: 'invalid' });
    const row = await getPrisma().settlement.findUniqueOrThrow({ where: { id } });
    expect(Number(row.amountMinor)).toBe(4200);
    expect(row.deletedAt).toBeNull();
  });

  it('lets a payment be re-pointed at another member while the editor stays one of the two', async () => {
    const { owner, third, id } = await recorded();

    const [result] = await pushOk(owner, [
      edit(id, { fromUserId: idOf(third), toUserId: idOf(owner) }),
    ]);

    expect(result).toMatchObject({ status: 'applied' });
  });

  it('refuses to move a payment onto two people the editor is neither of', async () => {
    const { member, third, id, owner } = await recorded();

    const [result] = await pushOk(owner, [
      edit(id, { fromUserId: idOf(third), toUserId: idOf(member) }),
    ]);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('refuses to move a payment onto someone who is not a member, or onto the same person twice', async () => {
    const { owner, id } = await recorded();
    const stranger = await createUser();

    const [outside] = await pushOk(owner, [edit(id, { fromUserId: idOf(stranger) })]);
    const [same] = await pushOk(owner, [edit(id, { fromUserId: idOf(owner) })]);

    expect(outside).toMatchObject({ status: 'invalid' });
    expect(same).toMatchObject({ status: 'invalid' });
  });

  it('is undone by deleting it, which every member then sees as a tombstone', async () => {
    const { owner, third, id } = await recorded();

    const [result] = await pushOk(owner, [edit(id, { deletedAt: T1 })]);

    expect(result).toMatchObject({ status: 'applied' });
    for (const who of [owner, third]) {
      const seen = await settlementsSeenBy(who);
      expect(seen[0]!.deletedAt).not.toBeNull();
    }
  });

  it('can be restored by the same people', async () => {
    const { owner, id } = await recorded();
    await pushOk(owner, [edit(id, { deletedAt: T1 })]);

    const [result] = await pushOk(owner, [edit(id, { deletedAt: null }, T2)]);

    expect(result).toMatchObject({ status: 'applied' });
    expect(((await settlementsSeenBy(owner))[0] as Settlement).deletedAt).toBeNull();
  });

  it('lets the later edit win, and tells the loser what the server holds', async () => {
    const { owner, member, id } = await recorded();
    await pushOk(owner, [edit(id, { amountMinor: 9000 }, T2)]);

    const [stale] = await pushOk(member, [edit(id, { amountMinor: 1000 }, T1)]);

    expect(stale).toMatchObject({ status: 'conflict_server_wins' });
    expect((stale!.record as Settlement).amountMinor).toBe(9000);
  });

  it('gives each change a new revision in the book’s stream', async () => {
    const { owner, id } = await recorded();
    const before = (await settlementsSeenBy(owner))[0]!.revision;

    await pushOk(owner, [edit(id, { amountMinor: 5000 })]);

    expect((await settlementsSeenBy(owner))[0]!.revision).toBeGreaterThan(before);
  });
});

describe('when the household changes', () => {
  it('keeps the history for those who stay when someone leaves, and lets them keep editing it', async () => {
    const { owner, member } = await householdOfTwo();
    const item = settlementItem(payment(member, owner), { updatedAt: T0 });
    await pushOk(member, [item]);
    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    const seen = await settlementsSeenBy(owner);
    const [edited] = await pushOk(owner, [settlementItem({ amountMinor: 100 }, { id: item.id })]);

    expect(seen.map((s) => s.id)).toEqual([item.id]);
    expect(seen[0]!.fromUserId).toBe(idOf(member));
    // The person who left is no longer a member, but the payment is only being corrected.
    expect(edited).toMatchObject({ status: 'applied' });
  });

  it('does not let someone who left touch it, nor see it', async () => {
    const { owner, member } = await householdOfTwo();
    const item = settlementItem(payment(member, owner), { updatedAt: T0 });
    await pushOk(member, [item]);
    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    const [result] = await pushOk(member, [settlementItem({ amountMinor: 1 }, { id: item.id })]);

    expect(result).toMatchObject({ status: 'invalid' });
    expect(await settlementsSeenBy(member)).toEqual([]);
  });

  it('refuses to record a payment with someone who has left', async () => {
    const { owner, member } = await householdOfTwo();
    await api().post('/v1/household/leave').set('Authorization', member.auth).send({});

    const [result] = await pushOk(owner, [settlementItem(payment(owner, member))]);

    expect(result).toMatchObject({ status: 'invalid' });
  });

  it('is dropped, not merged into the owner’s own books, when the household is deleted', async () => {
    const { owner, member } = await householdOfTwo();
    await pushOk(member, [settlementItem(payment(member, owner), { updatedAt: T0 })]);
    expect(await getPrisma().settlement.count()).toBe(1);

    const removed = await api().delete('/v1/household').set('Authorization', owner.auth);

    expect(removed.status).toBe(204);
    expect(await getPrisma().settlement.count()).toBe(0);
    expect(await settlementsSeenBy(owner)).toEqual([]);
  });
});

describe('housekeeping', () => {
  it('prunes a deleted payment after the tombstone horizon, like every other row', async () => {
    const { owner, member } = await householdOfTwo();
    const item = settlementItem(payment(owner, member), { updatedAt: T0 });
    await pushOk(owner, [item]);
    await pushOk(owner, [settlementItem({ deletedAt: T1 }, { id: item.id, updatedAt: T1 })]);
    const row = await getPrisma().settlement.findUniqueOrThrow({ where: { id: item.id } });

    const later = new Date(Date.now() + 91 * 24 * 3600 * 1000);
    const result = await pruneTombstones(getPrisma(), row.userId, later);

    expect(result.settlements).toBe(1);
    expect(await getPrisma().settlement.count({ where: { id: item.id } })).toBe(0);
  });

  it('keeps a live payment however old', async () => {
    const { owner, member } = await householdOfTwo();
    const item = settlementItem(payment(owner, member), { updatedAt: T0 });
    await pushOk(owner, [item]);
    const row = await getPrisma().settlement.findUniqueOrThrow({ where: { id: item.id } });

    const later = new Date(Date.now() + 400 * 24 * 3600 * 1000);
    const result = await pruneTombstones(getPrisma(), row.userId, later);

    expect(result.settlements).toBe(0);
    expect(await getPrisma().settlement.count({ where: { id: item.id } })).toBe(1);
  });
});
