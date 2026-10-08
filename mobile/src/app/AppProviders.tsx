import { type ReactNode, createContext, useContext } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../auth/SessionProvider';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { ApiClient } from '../api/client';
import type { AppContainer } from './container';

/**
 * Mounts one {@link AppContainer} into the tree.
 *
 * Kept separate from the root route so tests can wrap a hook or a component in exactly
 * the same providers the app uses, over a test container.
 */

const ApiContext = createContext<ApiClient | null>(null);

export interface AppProvidersProps {
  readonly container: AppContainer;
  readonly children: ReactNode;
}

export function AppProviders({ container, children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={container.queryClient}>
      <SessionProvider controller={container.session}>
        <ApiContext.Provider value={container.api}>
          <DatabaseProvider database={container.database}>{children}</DatabaseProvider>
        </ApiContext.Provider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

/**
 * The authenticated API client.
 *
 * Only two things should reach for this: the auth screens, which are the one place the
 * user waits on the network, and the sync engine. A feature screen that calls the API
 * directly has stepped outside the architecture - it reads from SQLite
 * (`docs/PLAN.md` §Mobile).
 */
export function useApiClient(): ApiClient {
  const api = useContext(ApiContext);
  if (api === null) {
    throw new Error('useApiClient must be used inside AppProviders');
  }
  return api;
}
