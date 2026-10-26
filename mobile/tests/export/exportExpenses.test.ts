import { exportExpenses, type ExportDependencies } from '@/export/exportExpenses';
import { writeUser } from '@/db/user';
import type { TestDatabase } from '../support/sqlite';
import { createTestDatabase } from '../support/sqlite';
import { migrate } from '@/db/migrations';
import { categoryId, expenseId, seedCategory, seedExpense } from '../support/seed';

/**
 * The export's orchestration over a real SQLite database, with the two native calls
 * (writing a file, opening the share sheet) replaced by recorders.
 */

const NOW = new Date(2026, 9, 26, 9, 0, 0);
const GROCERIES = categoryId(1);
const UNCATEGORIZED = categoryId(2);

let database: TestDatabase;
let written: { name: string; contents: string }[];
let shared: string[];

function deps(overrides: Partial<ExportDependencies> = {}): ExportDependencies {
  return {
    database,
    now: () => NOW,
    writeFile: (name, contents) => {
      written.push({ name, contents });
      return `file:///cache/${name}`;
    },
    isSharingAvailable: async () => true,
    shareFile: async (uri) => {
      shared.push(uri);
    },
    ...overrides,
  };
}

beforeEach(async () => {
  database = createTestDatabase();
  await migrate(database);
  written = [];
  shared = [];
  await writeUser(database, {
    id: '0192f5a0-0000-7000-8000-00000000a001',
    email: 'ada@example.com',
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await seedCategory(database, { id: GROCERIES, name: 'Groceries' });
  await seedCategory(database, { id: UNCATEGORIZED, name: 'Uncategorized', isDefault: true });
});

afterEach(() => {
  database.close();
});

describe('exportExpenses', () => {
  it('writes every live expense oldest first and opens the share sheet with the file', async () => {
    await seedExpense(database, {
      id: expenseId(2),
      categoryId: GROCERIES,
      amountMinor: 450,
      date: '2026-10-09',
    });
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: GROCERIES,
      amountMinor: 1250,
      date: '2026-10-08',
    });

    const result = await exportExpenses(deps());

    expect(result).toEqual({ status: 'shared', count: 2 });
    expect(written).toHaveLength(1);
    expect(written[0]?.name).toBe('expenses-2026-10-26.csv');
    expect(written[0]?.contents.split('\r\n').slice(1, 3)).toEqual([
      '2026-10-08,12.50,USD,Groceries,',
      '2026-10-09,4.50,USD,Groceries,',
    ]);
    expect(shared).toEqual(['file:///cache/expenses-2026-10-26.csv']);
  });

  it('leaves out deleted expenses', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: GROCERIES,
      date: '2026-10-08',
      amountMinor: 100,
    });
    await seedExpense(database, {
      id: expenseId(2),
      categoryId: GROCERIES,
      date: '2026-10-08',
      amountMinor: 200,
      deletedAt: '2026-10-10T00:00:00.000Z',
    });

    const result = await exportExpenses(deps());

    expect(result).toEqual({ status: 'shared', count: 1 });
    expect(written[0]?.contents).not.toContain(',2.00,');
  });

  it('exports an expense whose category is gone under the fallback category', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: categoryId(99),
      date: '2026-10-08',
      amountMinor: 700,
    });

    await exportExpenses(deps());

    expect(written[0]?.contents).toContain(',7.00,USD,Uncategorized,');
  });

  it('writes nothing and shares nothing when there is nothing to export', async () => {
    const result = await exportExpenses(deps());

    expect(result).toEqual({ status: 'empty' });
    expect(written).toEqual([]);
    expect(shared).toEqual([]);
  });

  it('writes no file on a platform that cannot share', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: GROCERIES,
      date: '2026-10-08',
      amountMinor: 100,
    });

    const result = await exportExpenses(deps({ isSharingAvailable: async () => false }));

    expect(result).toEqual({ status: 'unavailable' });
    expect(written).toEqual([]);
  });

  it('lets a failure to write or share reach the caller', async () => {
    await seedExpense(database, {
      id: expenseId(1),
      categoryId: GROCERIES,
      date: '2026-10-08',
      amountMinor: 100,
    });

    await expect(
      exportExpenses(
        deps({
          shareFile: async () => {
            throw new Error('share failed');
          },
        }),
      ),
    ).rejects.toThrow('share failed');
  });
});
