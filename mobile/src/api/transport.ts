import type { HttpMethod } from '@expense-tracker/shared';
import { NetworkUnavailableError } from './errors';

/**
 * The bottom layer: one HTTP round trip.
 *
 * It deliberately does **not** throw on a non-2xx. The 401 handling above it
 * (`authorize.ts`) has to inspect the status before anyone turns it into an error, and a
 * layer that threw first would force that logic to catch-and-rethrow. Only a request
 * that never got an answer at all is an exception here.
 */

/** Query values as they come off the shared schemas, before serialisation. */
export type QueryValue = string | number | boolean | undefined | null;

export interface TransportRequest {
  readonly method: HttpMethod;
  /** Path template from `API_ROUTES`, with `{param}` placeholders already substituted. */
  readonly path: string;
  readonly query?: Readonly<Record<string, QueryValue>> | undefined;
  /** Serialised as JSON. Omit for a request with no body. */
  readonly body?: unknown;
  /** Whether this route needs a token at all, straight from `API_ROUTES`. */
  readonly requiresAuth: boolean;
  /** Attached as `Authorization: Bearer`. Set by `authorize.ts`, not by callers. */
  readonly accessToken?: string | null | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface TransportResponse {
  readonly status: number;
  /** Parsed JSON, or `undefined` for an empty body (204) or an unparseable one. */
  readonly body: unknown;
  readonly requestId: string | null;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface TransportOptions {
  /** Base URL without a trailing slash and without the `/v1` prefix. */
  readonly baseUrl: string;
  /** Injectable so tests do not need a server. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Per-request timeout. A mobile radio can hold a socket open for minutes on a bad
   * connection; without a ceiling a sync pass started on app open never finishes and
   * never retries.
   */
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

export function buildQueryString(query: Readonly<Record<string, QueryValue>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // `undefined` and `null` mean "parameter absent". Serialising them would send the
    // strings "undefined"/"null", which the server's strict schemas reject.
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const serialised = params.toString();
  return serialised === '' ? '' : `?${serialised}`;
}

export function createTransport(options: TransportOptions): Transport {
  const { baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  return async function send(request: TransportRequest): Promise<TransportResponse> {
    const url = `${baseUrl}${request.path}${request.query ? buildQueryString(request.query) : ''}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (request.accessToken) {
      headers['Authorization'] = `Bearer ${request.accessToken}`;
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    // A caller-supplied signal (a screen unmounting) and the timeout both have to be
    // able to cancel the request.
    const onCallerAbort = () => timeout.abort();
    request.signal?.addEventListener('abort', onCallerAbort);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: request.method.toUpperCase(),
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: timeout.signal,
      });
    } catch (error) {
      // `fetch` rejects for exactly two reasons: no answer, or aborted. Both mean the
      // same thing to a sync pass - try again later.
      throw new NetworkUnavailableError(error);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onCallerAbort);
    }

    return {
      status: response.status,
      body: await readJsonBody(response),
      requestId: response.headers.get('x-request-id'),
    };
  };
}

/**
 * A 204 has no body, and an error from something in front of the API (a load balancer,
 * a captive portal) may answer HTML. Neither is a transport failure: the status is the
 * real information, so the body degrades to `undefined` and the layer above decides.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text().catch(() => '');
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
