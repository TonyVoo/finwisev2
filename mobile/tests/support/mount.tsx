import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { AuthResponse, TokenPair } from '@expense-tracker/shared';
import { AppProviders } from '@/bootstrap/AppProviders';
import { SessionProvider } from '@/auth/SessionProvider';
import type { SessionController, SessionSnapshot } from '@/auth/session';
import { type AppContainer, createAppContainer } from '@/bootstrap/container';
import type { Transport, TransportRequest, TransportResponse } from '@/api/transport';
import { migrate } from '@/db/migrations';
import type { Clock } from '@/lib/clock';
import { createTestDatabase, type TestDatabase } from './sqlite';
import { SAFE_AREA_METRICS } from './safeArea';

/**
 * Mounts an auth screen over a real container.
 *
 * The only two things faked here are the ones that cannot exist under jest: the network
 * (a {@link Transport} the test supplies) and the native safe-area metrics. Everything
 * between the tap and the stored token is the real thing — the real API client, the real
 * zod response parsing, the real session controller, the real `expo-secure-store`
 * adapter over the in-memory native mock from `tests/setup.ts`, and a real SQLite engine.
 *
 * That is deliberate, and it is what makes these cases evidence for the acceptance
 * criteria rather than for a mock's configuration. "A successful login stores the
 * session" is only interesting if the token really lands in the store the app reads on
 * its next cold start, so the assertion is made against that store and not against a
 * `signIn` spy.
 *
 * Queries go through RNTL's global `screen`, as everywhere else in this suite; what is
 * returned here is the state a screen test needs to *assert on* rather than query.
 */

export interface MountedScreen {
  readonly container: AppContainer;
  readonly database: TestDatabase;
  /** Every request the screen put on the wire, in order. */
  readonly requests: TransportRequest[];
}

export interface MountScreenOptions {
  /**
   * The network, for the two auth screens that use it.
   *
   * Optional, and the default is a transport that **fails the test if it is called**. The
   * expense and category screens are specified to read and write local SQLite and nothing
   * else (`TVO-11`: "no network in this task"), so a request escaping one of them is a
   * defect in the screen - and one that would otherwise show up as a passing test here and
   * a broken promise on a plane.
   */
  readonly transport?: Transport;
  /** Pins "today", so a dated assertion does not depend on the day the suite runs. */
  readonly clock?: Clock;
  /** Rows to put in the database before the first render. */
  readonly seed?: (database: TestDatabase) => Promise<void>;
}

const NO_NETWORK_EXPECTED: Transport = async (request) => {
  throw new Error(
    `This screen is specified to work offline and must not reach the network, but it ` +
      `requested ${request.method} ${request.path}`,
  );
};

export async function mountScreen(
  element: ReactElement,
  { transport = NO_NETWORK_EXPECTED, clock, seed }: MountScreenOptions = {},
): Promise<MountedScreen> {
  const database = createTestDatabase();
  await migrate(database);
  if (seed !== undefined) await seed(database);

  const requests: TransportRequest[] = [];
  const container = await createAppContainer({
    database,
    clock,
    transport: async (request) => {
      requests.push(request);
      return transport(request);
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <AppProviders container={container}>{children}</AppProviders>
      </SafeAreaProvider>
    );
  }

  await render(element, { wrapper: Wrapper });
  return { container, database, requests };
}

/**
 * Mount something that only consumes the session: Welcome, and the two route guards.
 *
 * None of those touch the API, the database or the query cache, so wiring a whole
 * container for them would be inventing dependencies in order to satisfy them. What they
 * do depend on is a {@link SessionSnapshot}, and the interesting values of it — expired,
 * anonymous, authenticated — are states a real controller only reaches through a
 * multi-step history. Handing the snapshot over directly is what lets each case name the
 * state it is about.
 */
export async function mountWithSession(
  element: ReactElement,
  snapshot: SessionSnapshot,
): Promise<void> {
  const controller: SessionController = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    initialize: async () => snapshot,
    getAccessToken: async () => null,
    ensureFreshAccessToken: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
  };

  await render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <SessionProvider controller={controller}>{element}</SessionProvider>
    </SafeAreaProvider>,
  );
}

/**
 * Type into a field, flushing the re-render before returning.
 *
 * The `act` is explicit and it is load-bearing. Under React 19 a bare
 * `fireEvent.changeText` schedules the state update without flushing it, so a test that
 * typed an address and then pressed Submit in the next statement would submit the
 * *empty* form - validation would fail, no request would be made, and the failure would
 * look like a bug in the screen rather than in the test. Wrapping it here means no
 * individual case has to remember.
 */
export async function typeInto(testID: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
  });
}

/** Press a control and let everything it started settle. */
export async function pressOn(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** Blur a field, which is when validation runs for the first time (§1.2 rule 2). */
export async function blur(testID: string): Promise<void> {
  await act(async () => {
    fireEvent(screen.getByTestId(testID), 'blur');
  });
}

/** A success response carrying `body`. */
export function ok(status: number, body: unknown): TransportResponse {
  return { status, body, requestId: 'req-test' };
}

/**
 * The error envelope the contract defines, as the transport would hand it back.
 *
 * Built here rather than imported so the tests exercise `toApiRequestError`'s real
 * parsing of a real envelope shape — which is the step that decides whether
 * `invalid_credentials` survives as a code or degrades to the generic banner.
 */
export function apiError(
  status: number,
  code: string,
  extra: { readonly message?: string; readonly details?: unknown } = {},
): TransportResponse {
  return {
    status,
    body: {
      error: {
        code,
        message: extra.message ?? `${code} from the test transport`,
        ...(extra.details === undefined ? {} : { details: extra.details }),
      },
    },
    requestId: 'req-test',
  };
}

export function tokenPair(suffix = '1'): TokenPair {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessTokenExpiresIn: 3600,
    refreshTokenExpiresAt: '2026-12-07T10:00:00.000Z',
  };
}

export function authResponse(
  overrides: { readonly email?: string; readonly currency?: string } = {},
): AuthResponse {
  return {
    user: {
      id: '0192f5a0-0000-7000-8000-00000000a001',
      email: overrides.email ?? 'ada@example.com',
      currency: overrides.currency ?? 'USD',
      createdAt: '2026-10-01T10:00:00.000Z',
    },
    ...tokenPair(),
  };
}

/** The raw native secure-store map from `tests/setup.ts`, for state assertions. */
export function secureStore(): Map<string, string> {
  return (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;
}
