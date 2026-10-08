/**
 * Query keys, declared in one place.
 *
 * Every key starts with `local` to say what the cache holds: the result of a SQLite
 * read, not a server response. The distinction is the architecture
 * (`docs/PLAN.md` §Mobile), and a key named `['categories']` invites someone to put a
 * `GET /v1/categories` result under it and quietly introduce a second read path.
 *
 * Keys are hierarchical so a coarse invalidation works: `invalidateQueries({ queryKey:
 * queryKeys.expenses.all() })` covers every month and filter below it, which is what a
 * sync pull needs after writing rows it cannot cheaply map back to screens.
 */
export const queryKeys = {
  categories: {
    all: () => ['local', 'categories'] as const,
    live: () => ['local', 'categories', 'live'] as const,
  },
  expenses: {
    all: () => ['local', 'expenses'] as const,
    /** @param month `YYYY-MM`, the bucket monthly totals group on. */
    month: (month: string) => ['local', 'expenses', 'month', month] as const,
  },
  outbox: {
    pendingCount: () => ['local', 'outbox', 'pendingCount'] as const,
  },
} as const;
