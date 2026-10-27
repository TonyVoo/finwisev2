import { migrate } from '@/db/migrations';
import { createGoal, deleteGoal, depositToGoal, updateGoal } from '@/db/mutations';
import { listLiveGoals } from '@/db/queries';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

const ID = '0192f5a0-0000-7000-8000-0000000000a1';
const ID2 = '0192f5a0-0000-7000-8000-0000000000a2';

describe('savings goals, locally', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });
  afterEach(() => database.close());

  const outbox = () =>
    database.getAllAsync<{ entity: string; fields: string }>(
      'SELECT entity, fields FROM outbox ORDER BY seq',
      [],
    );

  it('creates a goal and queues it as a goal', async () => {
    await createGoal(
      database,
      { name: ' Holiday ', targetMinor: 100000, savedMinor: 0, currency: 'USD', deadline: null },
      { id: ID },
    );

    expect(await listLiveGoals(database)).toEqual([
      expect.objectContaining({
        id: ID,
        name: 'Holiday',
        targetMinor: 100000,
        savedMinor: 0,
        deadline: null,
        pending: true,
      }),
    ]);
    const [entry] = await outbox();
    expect(entry!.entity).toBe('goal');
    expect(JSON.parse(entry!.fields)).toEqual({
      name: 'Holiday',
      targetMinor: 100000,
      savedMinor: 0,
      currency: 'USD',
    });
  });

  it('adds a deposit to the stored balance, not to whatever the screen showed', async () => {
    await createGoal(
      database,
      { name: 'Laptop', targetMinor: 200000, savedMinor: 5000, currency: 'USD', deadline: null },
      { id: ID },
    );
    await depositToGoal(database, ID, 2500);
    await depositToGoal(database, ID, 2500);

    expect((await listLiveGoals(database))[0]!.savedMinor).toBe(10000);
  });

  it('caps a deposit at the largest amount the contract allows', async () => {
    await createGoal(
      database,
      {
        name: 'Big',
        targetMinor: 999999999999,
        savedMinor: 999999999000,
        currency: 'USD',
        deadline: null,
      },
      { id: ID },
    );
    await depositToGoal(database, ID, 5000);
    expect((await listLiveGoals(database))[0]!.savedMinor).toBe(999999999999);
  });

  it('edits only the named fields, and clears a deadline with null', async () => {
    await createGoal(
      database,
      { name: 'Car', targetMinor: 5000000, savedMinor: 0, currency: 'USD', deadline: '2027-06-01' },
      { id: ID },
    );
    await updateGoal(database, ID, { name: 'New car' });
    await updateGoal(database, ID, { deadline: null });

    const [goal] = await listLiveGoals(database);
    expect(goal).toMatchObject({ name: 'New car', deadline: null, targetMinor: 5000000 });
  });

  it('deletes with a tombstone, so it leaves the list but a delete can sync', async () => {
    await createGoal(
      database,
      { name: 'Gone', targetMinor: 100, savedMinor: 0, currency: 'USD', deadline: null },
      { id: ID },
    );
    await deleteGoal(database, ID);

    expect(await listLiveGoals(database)).toEqual([]);
    const row = await database.getFirstAsync<{ deletedAt: string | null }>(
      'SELECT deletedAt FROM goals WHERE id = ?',
      [ID],
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  it('orders by deadline, soonest first, with no deadline last', async () => {
    await createGoal(
      database,
      { name: 'B later', targetMinor: 100, savedMinor: 0, currency: 'USD', deadline: '2027-06-01' },
      { id: ID },
    );
    await createGoal(
      database,
      { name: 'A none', targetMinor: 100, savedMinor: 0, currency: 'USD', deadline: null },
      { id: ID2 },
    );
    await createGoal(
      database,
      { name: 'C soon', targetMinor: 100, savedMinor: 0, currency: 'USD', deadline: '2026-12-01' },
      { id: '0192f5a0-0000-7000-8000-0000000000a3' },
    );

    expect((await listLiveGoals(database)).map((goal) => goal.name)).toEqual([
      'C soon',
      'B later',
      'A none',
    ]);
  });
});
