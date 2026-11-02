import { applyImport, prepareImport } from '@/import/importExpenses';
import { migrate } from '@/db/migrations';
import { writeUser } from '@/db/user';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';
import { categoryId, outboxEntries, seedCategory, seedFallbackCategory } from '../support/seed';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

let database: TestDatabase;
beforeEach(async () => {
  database = await createTestDatabase();
  await migrate(database);
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedFallbackCategory(database);
  await seedCategory(database, { id: categoryId(1), name: 'Food', color: '#2F8044' });
});

const FILE = 'Date,Amount,Category,Note\n2026-10-05,12.50,Food,Lunch\n2026-10-06,3,Pets,Tea\n';
const deps = (text: string | null) => ({
  database,
  homeCurrency: 'USD',
  pickText: async () => text,
});

describe('importing a file', () => {
  it('does nothing when the person cancels', async () => {
    expect(await prepareImport(deps(null))).toBeNull();
  });

  it('plans from the real categories and adds nothing until applied', async () => {
    const plan = await prepareImport(deps(FILE));

    expect(plan?.entries).toHaveLength(2);
    expect(plan?.entries[0]).toMatchObject({ categoryId: categoryId(1), amountMinor: 1250 });
    expect(plan?.unmatchedCategories).toBe(1);
    expect(await outboxEntries(database)).toEqual([]);
  });

  it('adds ordinary entries that sync, and a second import of the same file adds none', async () => {
    const plan = await prepareImport(deps(FILE));
    expect(await applyImport(database, plan!.entries)).toBe(2);

    const queued = (await outboxEntries(database)).filter((e) => e.entity === 'expense');
    expect(queued).toHaveLength(2);

    const again = await prepareImport(deps(FILE));
    expect(again?.entries).toEqual([]);
    expect(again?.skipped).toEqual({ duplicate: 2 });
  });
});
