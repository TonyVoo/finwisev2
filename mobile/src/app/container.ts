import type { QueryClient } from '@tanstack/react-query';
import { type ApiClient, createApiClient } from '../api/client';
import { resolveApiBaseUrl } from '../api/config';
import { createAuthorizedTransport } from '../api/authorize';
import { type Transport, createTransport } from '../api/transport';
import { type SessionController, createSessionController } from '../auth/session';
import { type TokenStore, createSecureTokenStore } from '../auth/tokenStore';
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
 */

export interface AppContainer {
  readonly database: SqliteDatabase;
  readonly session: SessionController;
  /** Authenticated client. Every call carries a bearer token and refreshes on 401. */
  readonly api: ApiClient;
  readonly queryClient: QueryClient;
}

export interface AppContainerOptions {
  /** Overridable so tests can build a container without native modules. */
  readonly database?: SqliteDatabase;
  readonly tokenStore?: TokenStore;
  readonly transport?: Transport;
  readonly queryClient?: QueryClient;
}

export async function createAppContainer(options: AppContainerOptions = {}): Promise<AppContainer> {
  const transport = options.transport ?? createTransport({ baseUrl: resolveApiBaseUrl() });

  // Unauthenticated on purpose: the refresh call must not pass through the interceptor
  // it is there to serve.
  const publicApi = createApiClient({ transport });

  const session = createSessionController({
    tokenStore: options.tokenStore ?? createSecureTokenStore(),
    refreshTokens: (refreshToken) => publicApi.refresh({ refreshToken }),
  });

  const api = createApiClient({ transport: createAuthorizedTransport(transport, session) });

  // Opening the database and reading the session are independent, and both gate the
  // first frame, so they overlap.
  const [database] = await Promise.all([
    options.database ?? openLocalDatabase(),
    session.initialize(),
  ]);

  return {
    database,
    session,
    api,
    queryClient: options.queryClient ?? createQueryClient(),
  };
}
