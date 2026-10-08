import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { DatabaseProvider } from '@/db/DatabaseProvider';
import { useLiveCategories, usePendingRecordCount } from '@/db/hooks';
import { migrate } from '@/db/migrations';
import { applyLocalMutation } from '@/db/write';
import { createQueryClient } from '@/query/client';
import { queryKeys } from '@/query/keys';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

/**
 * The read path, end to end: SQLite -> a query function -> TanStack Query -> a hook.
 *
 * Nothing is mocked except the SQLite engine, and that is a real engine. The point is to
 * prove the pattern works before any feature screen is built on it, because every
 * screen in the app reads this way (`docs/PLAN.md` §Mobile).
 */

const CATEGORY_IDS = [
  '0192f5a0-0000-7000-8000-000000000001',
  '0192f5a0-0000-7000-8000-000000000002',
];

const AT = new Date('2026-10-08T10:30:00.000Z');

describe('reads through TanStack Query', () => {
  let database: TestDatabase;
  let queryClient: ReturnType<typeof createQueryClient>;
  let mutationId = 0;

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DatabaseProvider database={database}>{children}</DatabaseProvider>
      </QueryClientProvider>
    );
  }

  const addCategory = (id: string, name: string) =>
    applyLocalMutation(
      database,
      { entity: 'category', id, fields: { name, color: '#2F8044' } },
      {
        clock: () => AT,
        newMutationId: () => `0192f5a0-0000-7000-8000-10000000000${(mutationId += 1)}`,
      },
    );

  beforeEach(async () => {
    database = createTestDatabase();
    queryClient = createQueryClient();
    mutationId = 0;
    await migrate(database);
  });

  afterEach(() => {
    queryClient.clear();
    database.close();
  });

  it('resolves to the rows SQLite holds', async () => {
    await addCategory(CATEGORY_IDS[0]!, 'Transport');
    await addCategory(CATEGORY_IDS[1]!, 'Groceries');

    const { result } = await renderHook(() => useLiveCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Ordered by name, per docs/design/07-categories.md.
    expect(result.current.data?.map((category) => category.name)).toEqual([
      'Groceries',
      'Transport',
    ]);
  });

  it('marks a row with an undrained outbox entry as pending', async () => {
    await addCategory(CATEGORY_IDS[0]!, 'Groceries');

    const { result } = await renderHook(() => useLiveCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The outbox is the single source of truth for `pending`
    // (docs/design/02-offline-and-sync.md §2), so it is derived, never stored.
    expect(result.current.data?.[0]).toMatchObject({ name: 'Groceries', pending: true });
  });

  it('stops being pending once the outbox entry drains', async () => {
    await addCategory(CATEGORY_IDS[0]!, 'Groceries');
    await database.runAsync('DELETE FROM outbox', []);

    const { result } = await renderHook(() => useLiveCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]?.pending).toBe(false);
  });

  it('hides tombstoned rows', async () => {
    await addCategory(CATEGORY_IDS[0]!, 'Groceries');
    await applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_IDS[0]!, fields: { deletedAt: AT.toISOString() } },
      { clock: () => AT, newMutationId: () => '0192f5a0-0000-7000-8000-100000000099' },
    );

    const { result } = await renderHook(() => useLiveCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The row stays in the table because sync has to carry the delete, but the UI must
    // never show it.
    expect(result.current.data).toEqual([]);
    await expect(database.getAllAsync('SELECT id FROM categories', [])).resolves.toHaveLength(1);
  });

  it('re-reads after an invalidation', async () => {
    const { result } = await renderHook(() => useLiveCategories(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);

    await addCategory(CATEGORY_IDS[0]!, 'Groceries');
    // Freshness is an event, not a timer: with `staleTime: Infinity` the only thing that
    // can move this cache is an explicit invalidation by whatever caused the change.
    await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all() });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it('counts distinct records in the pending count, not outbox entries', async () => {
    await addCategory(CATEGORY_IDS[0]!, 'Groceries');
    await applyLocalMutation(
      database,
      { entity: 'category', id: CATEGORY_IDS[0]!, fields: { name: 'Food' } },
      { clock: () => AT, newMutationId: () => '0192f5a0-0000-7000-8000-100000000098' },
    );

    const { result } = await renderHook(() => usePendingRecordCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Two outbox entries, one record. The sync pill reads "{n} pending" as records
    // (docs/design/02-offline-and-sync.md §3 rule 5).
    await expect(database.getAllAsync('SELECT seq FROM outbox', [])).resolves.toHaveLength(2);
    expect(result.current.data).toBe(1);
  });

  it('fails loudly when a hook is used without a DatabaseProvider', async () => {
    // React logs the thrown render error; silenced so the suite output stays readable.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    // A missing provider must not degrade to an empty list. A screen that silently
    // renders "no expenses" because the database was never wired up looks exactly like
    // a user who has no expenses.
    await expect(
      renderHook(() => useLiveCategories(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      }),
    ).rejects.toThrow(/DatabaseProvider/);

    consoleError.mockRestore();
  });
});
