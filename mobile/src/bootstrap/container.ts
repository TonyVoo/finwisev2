import type { QueryClient } from '@tanstack/react-query';
import { type ApiClient, createApiClient } from '../api/client';
import { resolveApiBaseUrl } from '../api/config';
import { createAuthorizedTransport } from '../api/authorize';
import { type Transport, createTransport } from '../api/transport';
import { type SessionController, createSessionController } from '../auth/session';
import type { TokenStore } from '../auth/sessionRecord';
import { createSecureTokenStore } from '../auth/tokenStore';
import { type Clock, systemClock } from '../lib/clock';
import { createSqliteLocalStore } from '../db/localStore';
import { generateDueRecurring } from '../recurring/generate';
import { META_KEYS, readMeta } from '../db/meta';
import { type ThemePreference, parseThemePreference } from '../theme/ThemeProvider';
import { openLocalDatabase } from '../db/open';
import type { SqliteDatabase } from '../db/sqlite';
import { createQueryClient } from '../query/client';
import { queryKeys } from '../query/keys';
import { syncReceipts } from '../receipts/receiptSync';
import { type SyncEngine, createSyncEngine } from '../sync/engine';
import { type Reachability, createNetInfoReachability } from '../sync/reachability';

/**
 * Builds the app's long-lived objects and wires them together.
 *
 * It exists because the wiring has one knot in it. The 401 interceptor needs the session
 * controller, and the session controller needs something that can call
 * `POST /v1/auth/refresh`. Resolving that by importing one from the other would make the
 * refresh call go *through* the interceptor, so a 401 on a refresh would trigger a
 * refresh. Instead the raw transport is built first, an unauthenticated client on top of
 * it supplies `refreshTokens`, and only then is the authorized client built. Written out
 * here, in order, rather than hidden in module-level singletons.
 *
 * The order has a second constraint now, and it is the one `TVO-16` was about: the
 * session controller also needs the open database, because settling a session means
 * deciding whether the local store it is about to read belongs to that user. So the
 * database is opened first and `session.initialize()` runs last.
 */

export interface AppContainer {
  readonly database: SqliteDatabase;
  readonly session: SessionController;
  /** Authenticated client. Every call carries a bearer token and refreshes on 401. */
  readonly api: ApiClient;
  readonly queryClient: QueryClient;
  /**
   * The wall clock every dated decision reads.
   *
   * Carried on the container so the whole tree agrees on "today" and a test can pin it.
   * The screens need it for more than `updatedAt`: which day heading an expense falls
   * under, whether Next on the month switcher is at the current month, and what the date
   * sheet's `Today` means are all answers to this question (`docs/design/04-expense-list.md`
   * rule 2, `05-month-switcher.md` rule 2).
   */
  readonly clock: Clock;
  /**
   * The sync engine, built here and never anywhere else.
   *
   * One per app, for the reason `engine.ts` gives: the single-flight guard is per engine,
   * so two engines are two concurrent drains over one outbox. `SyncProvider` mounts this
   * one and the background task borrows it.
   */
  readonly sync: SyncEngine;
  /**
   * The theme the person chose in Settings, read before the first frame so the app opens
   * in it rather than flashing the system one. A device setting, not account data: it is
   * not in the wiped meta keys, so logging out leaves it alone.
   */
  readonly themePreference: ThemePreference;
}

export interface AppContainerOptions {
  /** Overridable so tests can build a container without native modules. */
  readonly database?: SqliteDatabase;
  readonly tokenStore?: TokenStore;
  readonly transport?: Transport;
  readonly queryClient?: QueryClient;
  /** Pinnable so a dated assertion does not depend on the day the suite runs. */
  readonly clock?: Clock;
  /**
   * Overridable because netinfo is a native module, and because a test that wants to be
   * offline should say so rather than unplugging something
   * (`createMemoryReachability` in `sync/reachability.ts`).
   */
  readonly reachability?: Reachability;
}

export async function createAppContainer(options: AppContainerOptions = {}): Promise<AppContainer> {
  const transport = options.transport ?? createTransport({ baseUrl: resolveApiBaseUrl() });

  // Unauthenticated on purpose: the refresh call must not pass through the interceptor
  // it is there to serve.
  const publicApi = createApiClient({ transport });

  // The database is opened *before* the session rather than alongside it. These two used
  // to overlap, on the reasoning that they are independent - and that was the bug: the
  // store a session is about to read may belong to a different user, and deciding that
  // needs both halves (`src/db/localStore.ts`). Both are local and fast, so the cost of
  // serialising them is a few milliseconds of splash screen.
  const database = options.database ?? (await openLocalDatabase());

  const session = createSessionController({
    tokenStore: options.tokenStore ?? createSecureTokenStore(),
    localStore: createSqliteLocalStore(database),
    refreshTokens: (refreshToken) => publicApi.refresh({ refreshToken }),
    // Unauthenticated client, like the refresh: the body carries the token being revoked.
    revokeRefreshToken: (refreshToken) => publicApi.logout({ refreshToken }),
  });

  const api = createApiClient({ transport: createAuthorizedTransport(transport, session) });

  await session.initialize();

  const queryClient = options.queryClient ?? createQueryClient();
  const clock = options.clock ?? systemClock;

  const sync = createSyncEngine({
    database,
    api,
    session,
    reachability: options.reachability ?? createNetInfoReachability(),
    clock,
    // A sync that wrote rows has to invalidate the reads, for the same reason a local
    // write does: every query in this app is configured `staleTime: Infinity` and
    // nothing re-reads unless something invalidates (`db/localWrite.ts`). Without this
    // a pull would land rows in SQLite that no screen showed until the next user edit.
    onLocalDataChanged: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.local() });
    },
    // Due recurring expenses are created here: locally, offline, at launch and at the start
    // of every pass, so a rule that fired while the app was closed has its expenses by the
    // time the first screen reads - and the drain that follows sends them.
    syncReceipts: (guard) => syncReceipts({ database, api, guard }),
    beforeSync: async () => {
      if (session.getSnapshot().status !== 'authenticated') return;
      const created = await generateDueRecurring(database, { clock });
      if (created > 0) void queryClient.invalidateQueries({ queryKey: queryKeys.local() });
    },
  });

  // A session arriving is a sync trigger (`TVO-34`). `engine.start()` runs when the app
  // mounts, which for a logged-out user is before there is a bearer token: that pull takes
  // a 401 and sets the pill's failure flag, and nothing else would ever sync again until
  // the user happened to background the app. Done here rather than in `SyncProvider`
  // because the container is where the engine and the session are first both in hand, and
  // the join works wherever the provider is mounted. Only the transition *into*
  // `authenticated` counts - a token rotation or a sign-out is not a reason to sync.
  let wasAuthenticated = session.getSnapshot().status === 'authenticated';
  session.subscribe(() => {
    const isAuthenticated = session.getSnapshot().status === 'authenticated';
    if (isAuthenticated && !wasAuthenticated) void sync.sync('sign-in');
    wasAuthenticated = isAuthenticated;
  });

  // Nothing the previous account read may be painted for the next one. Rows are wiped from
  // SQLite on logout, but the query cache is a second copy, and the first frame of a new
  // session would otherwise show it before any read re-runs. Dropped on the transition to
  // `anonymous`, which covers an explicit logout and a forced clear alike.
  session.subscribe(() => {
    if (session.getSnapshot().status === 'anonymous') {
      queryClient.removeQueries({ queryKey: queryKeys.local() });
    }
  });

  const themePreference = parseThemePreference(await readMeta(database, META_KEYS.themePreference));

  return { database, session, api, queryClient, clock, sync, themePreference };
}
