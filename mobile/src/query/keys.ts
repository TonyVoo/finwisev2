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
  /**
   * The caller's household, from the server. The one key that is **not** a SQLite read, so it
   * deliberately does not start with `local` and is not cleared by a local invalidation.
   */
  household: () => ['household'] as const,
  /** Who is in the household, as last stored from `/v1/me` - a SQLite read, so under `local`. */
  householdMembers: () => ['local', 'household', 'members'] as const,
  /** Everything read out of SQLite, i.e. the whole cache. See `localWrite.ts`. */
  local: () => ['local'] as const,

  /** When the last sync completed, as persisted - what tells "empty" from "not loaded yet". */
  lastSyncedAt: () => ['local', 'sync', 'lastSyncedAt'] as const,

  categories: {
    all: () => ['local', 'categories'] as const,
    live: () => ['local', 'categories', 'live'] as const,
    /** The category list's rows, which carry an all-time expense count each. */
    withCounts: () => ['local', 'categories', 'withCounts'] as const,
    /** The live `isDefault` row - the reassignment target and the add-mode fallback. */
    fallback: () => ['local', 'categories', 'fallback'] as const,
    /** The category to preselect in add mode (`06-expense-form.md` rule 1). */
    lastUsed: () => ['local', 'categories', 'lastUsed'] as const,
    /** Colours worn by a live category, for the picker's `In use` labels. */
    coloursInUse: () => ['local', 'categories', 'coloursInUse'] as const,
  },

  expenses: {
    all: () => ['local', 'expenses'] as const,
    /** @param month `YYYY-MM`, the bucket monthly totals group on. */
    month: (month: string) => ['local', 'expenses', 'month', month] as const,
    /**
     * A month's total, keyed separately from its page.
     *
     * The total is computed in SQLite over the whole month and the page is windowed, so
     * they are two different reads and must not share a key - `04-expense-list.md` rule 3
     * is explicit that the total is never derived from the rendered page.
     */
    monthTotal: (month: string) => ['local', 'expenses', 'monthTotal', month] as const,
    incomeTrend: (month: string) => ['local', 'expenses', 'incomeTrend', month] as const,
    /** The month's private spend, for the line under the total. */
    monthPrivate: (month: string) => ['local', 'expenses', 'monthPrivate', month] as const,
    monthDailySpend: (month: string) => ['local', 'expenses', 'monthDailySpend', month] as const,
    monthIncome: (month: string) => ['local', 'expenses', 'monthIncome', month] as const,
    /**
     * A month's spend per category - the Summary's one read.
     *
     * Its own key rather than a selector over `monthTotal`, because it answers more than
     * the total: the chart, the legend and the expense count all come off these rows, and
     * `08-monthly-summary.md` rule 1 requires them to be the same aggregate so they cannot
     * disagree with each other.
     */
    monthByCategory: (month: string) => ['local', 'expenses', 'monthByCategory', month] as const,
    /** Spend per month over the six months ending at the given one - the Summary's trend. */
    trend: (endMonth: string) => ['local', 'expenses', 'trend', endMonth] as const,
    /** A search over every month. The text and category are part of the key. */
    search: (text: string, categoryId: string | null) =>
      ['local', 'expenses', 'search', text, categoryId] as const,
    detail: (id: string) => ['local', 'expenses', 'detail', id] as const,
    /** Whether any expense exists at all - which of Home's two empty states applies. */
    anyExist: () => ['local', 'expenses', 'anyExist'] as const,
    /** Months holding at least one expense, for the picker grid's dots. */
    months: () => ['local', 'expenses', 'months'] as const,
  },

  receipts: {
    /** One expense's receipt row: its state and, when held, the image. */
    detail: (expenseId: string) => ['local', 'receipts', expenseId] as const,
  },

  recurring: {
    all: () => ['local', 'recurring'] as const,
    /** Every live rule, with its category's name and colour. */
    live: () => ['local', 'recurring', 'live'] as const,
  },

  goals: {
    all: () => ['local', 'goals'] as const,
    live: () => ['local', 'goals', 'live'] as const,
  },

  user: {
    /** The currency every amount on every screen is formatted in. */
    currency: () => ['local', 'user', 'currency'] as const,
    /** The account's email, shown read-only on Settings. */
    email: () => ['local', 'user', 'email'] as const,
    /** The account's own display name, shown on Settings. */
    displayName: () => ['local', 'user', 'displayName'] as const,
    /** Whether that email is verified; Settings offers the check while it is not. */
    emailVerified: () => ['local', 'user', 'emailVerified'] as const,
  },

  onboarding: {
    /** Whether Home should still offer to review the categories created at signup. */
    categoryReview: () => ['local', 'onboarding', 'categoryReview'] as const,
    categoryRename: () => ['local', 'onboarding', 'categoryRename'] as const,
  },

  outbox: {
    pendingCount: () => ['local', 'outbox', 'pendingCount'] as const,
    /** The queued changes the sync sheet lists, one per record (§4). */
    pendingChanges: () => ['local', 'outbox', 'pendingChanges'] as const,
  },
} as const;
