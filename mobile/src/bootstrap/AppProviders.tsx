import { type ReactNode, createContext, useCallback, useContext } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../auth/SessionProvider';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { MonthProvider } from '../month/MonthProvider';
import { SnackbarProvider } from '../components/Snackbar';
import { SyncProvider } from '../sync/SyncProvider';
import { AppLockProvider } from '../lock/AppLockProvider';
import { META_KEYS, writeMeta } from '../db/meta';
import { ThemeProvider } from '../theme/ThemeProvider';
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
  /**
   * Whether the sync triggers are wired. See `sync/SyncProvider.tsx` - the app leaves it
   * alone, and the screen suites pass `false` because their screens are specified to
   * touch no network at all.
   */
  readonly startSync?: boolean;
  readonly children: ReactNode;
}

/**
 * `MonthProvider` and `SnackbarProvider` sit here, above the router, for the same reason
 * in both cases: a screen that owned either of them could not keep the guarantee the
 * design asks of it.
 *
 * The month must be identical on both tabs (`docs/design/05-month-switcher.md` rule 7),
 * and only one snackbar may be visible at a time with a new one replacing the current one
 * (`00-foundations.md` §6) - a rule the expense list depends on when a second delete lands
 * while the first one's Undo is still up. Per-screen state could satisfy neither.
 *
 * The snackbar is outermost of the two so it renders above everything, including the
 * sheets and dialogs that can ask for one.
 */
export function AppProviders({ container, startSync = true, children }: AppProvidersProps) {
  const { database } = container;
  // Fire-and-forget: a failed write must not undo a choice already on screen.
  const saveTheme = useCallback(
    (next: string) => {
      void writeMeta(database, META_KEYS.themePreference, next).catch(() => undefined);
    },
    [database],
  );

  return (
    <ThemeProvider initialPreference={container.themePreference} onPreferenceChange={saveTheme}>
      <QueryClientProvider client={container.queryClient}>
        <SessionProvider controller={container.session}>
          <ApiContext.Provider value={container.api}>
            <DatabaseProvider database={container.database}>
              {/* Inside `DatabaseProvider` and above the screens: the engine reads the same
                database the screens do, and `useLocalWrite` reaches up to it to trigger a
                sync once a write has settled. */}
              <SyncProvider engine={container.sync} enabled={startSync}>
                <SnackbarProvider>
                  <AppLockProvider
                    database={container.database}
                    initialEnabled={container.appLockEnabled}
                  >
                    <MonthProvider clock={container.clock}>{children}</MonthProvider>
                  </AppLockProvider>
                </SnackbarProvider>
              </SyncProvider>
            </DatabaseProvider>
          </ApiContext.Provider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
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
