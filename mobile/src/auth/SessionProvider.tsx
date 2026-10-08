import { type ReactNode, createContext, useContext, useSyncExternalStore } from 'react';
import type { SessionController, SessionSnapshot } from './session';

/**
 * Exposes the session store to React.
 *
 * `useSyncExternalStore` rather than state lifted into a component: the controller is
 * also driven from outside the tree - the 401 interceptor refreshes, a background sync
 * task reads the token - and those updates have to reach the route guards. Holding the
 * truth in component state would mean the tree and the interceptor can disagree about
 * whether there is a session.
 */
const SessionContext = createContext<SessionController | null>(null);

export interface SessionProviderProps {
  readonly controller: SessionController;
  readonly children: ReactNode;
}

export function SessionProvider({ controller, children }: SessionProviderProps) {
  return <SessionContext.Provider value={controller}>{children}</SessionContext.Provider>;
}

export function useSessionController(): SessionController {
  const controller = useContext(SessionContext);
  if (controller === null) {
    throw new Error('useSessionController must be used inside a SessionProvider');
  }
  return controller;
}

/** The current session state. Re-renders on every change the controller publishes. */
export function useSession(): SessionSnapshot {
  const controller = useSessionController();
  return useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}
