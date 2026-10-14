import type { QueryClient } from '@tanstack/react-query';
import { type ApiClient, createApiClient } from '../api/client';
import { resolveApiBaseUrl } from '../api/config';
import { createAuthorizedTransport } from '../api/authorize';
import { type Transport, createTransport } from '../api/transport';
import { type SessionController, createSessionController } from '../auth/session';
import { type TokenStore, createSecureTokenStore } from '../auth/tokenStore';
import { type Clock, systemClock } from '../lib/clock';
import { createSqliteLocalStore } from '../db/localStore';
import { openLocalDatabase } from '../db/open';
import type { SqliteDatabase } from '../db/sqlite';
import { createQueryClient } from '../query/client';

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
}

export interface AppContainerOptions {
  /** Overridable so tests can build a container without native modules. */
  readonly database?: SqliteDatabase;
  readonly tokenStore?: TokenStore;
  readonly transport?: Transport;
  readonly queryClient?: QueryClient;
  /** Pinnable so a dated assertion does not depend on the day the suite runs. */
  readonly clock?: Clock;
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
  });

  const api = createApiClient({ transport: createAuthorizedTransport(transport, session) });

  await session.initialize();

  return {
    database,
    session,
    api,
    queryClient: options.queryClient ?? createQueryClient(),
    clock: options.clock ?? systemClock,
  };
}
