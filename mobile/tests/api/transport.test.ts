import { NetworkUnavailableError } from '@/api/errors';
import { DEFAULT_TIMEOUT_MS, buildQueryString, createTransport } from '@/api/transport';

const BASE_URL = 'https://api.example.test';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/**
 * Wraps a response factory in the full `fetch` signature, so `mock.calls` is a typed
 * tuple and a test can read back the headers and body that were actually sent.
 */
function fetchMock(respond: () => Response) {
  return async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => respond();
}

describe('buildQueryString', () => {
  it('is empty when nothing is set', () => {
    expect(buildQueryString({})).toBe('');
    // Absent means absent. Serialising these would send the literal strings
    // "undefined"/"null", which the server's strict schemas reject.
    expect(buildQueryString({ since: undefined, limit: null })).toBe('');
  });

  it('serialises numbers and booleans', () => {
    expect(buildQueryString({ since: 42, limit: 200 })).toBe('?since=42&limit=200');
    expect(buildQueryString({ includeDeleted: false })).toBe('?includeDeleted=false');
  });

  it('percent-encodes values', () => {
    expect(buildQueryString({ cursor: 'a b/c&d' })).toBe('?cursor=a+b%2Fc%26d');
  });
});

describe('createTransport', () => {
  it('builds the URL from the base, the path and the query', async () => {
    const fetchImpl = jest.fn(fetchMock(() => jsonResponse({ ok: true })));
    const transport = createTransport({ baseUrl: BASE_URL, fetchImpl });

    await transport({
      method: 'get',
      path: '/v1/sync',
      query: { since: 7 },
      requiresAuth: true,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/v1/sync?since=7',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends the access token as a bearer header', async () => {
    const fetchImpl = jest.fn(fetchMock(() => jsonResponse({})));
    const transport = createTransport({ baseUrl: BASE_URL, fetchImpl });

    await transport({ method: 'get', path: '/v1/me', requiresAuth: true, accessToken: 'abc' });

    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer abc' });
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchImpl = jest.fn(fetchMock(() => jsonResponse({})));
    const transport = createTransport({ baseUrl: BASE_URL, fetchImpl });

    await transport({ method: 'get', path: '/v1/health', requiresAuth: false });

    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('sends a JSON body and only then sets Content-Type', async () => {
    const fetchImpl = jest.fn(fetchMock(() => jsonResponse({})));
    const transport = createTransport({ baseUrl: BASE_URL, fetchImpl });

    await transport({
      method: 'post',
      path: '/v1/auth/login',
      requiresAuth: false,
      body: { email: 'a@b.test', password: 'hunter22' },
    });
    const withBody = fetchImpl.mock.calls[0]![1]!;
    expect(withBody.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(withBody.body).toBe('{"email":"a@b.test","password":"hunter22"}');

    await transport({ method: 'get', path: '/v1/me', requiresAuth: true });
    const withoutBody = fetchImpl.mock.calls[1]![1]!;
    expect(withoutBody.headers).not.toHaveProperty('Content-Type');
    expect(withoutBody.body).toBeUndefined();
  });

  it('returns the status without throwing on a non-2xx', async () => {
    const body = { error: { code: 'not_found', message: 'No such expense' } };
    const transport = createTransport({
      baseUrl: BASE_URL,
      fetchImpl: async () => jsonResponse(body, { status: 404 }),
    });

    // The 401 interceptor has to see the status before anyone turns it into an error.
    const response = await transport({ method: 'get', path: '/v1/expenses', requiresAuth: true });
    expect(response).toEqual({ status: 404, body, requestId: null });
  });

  it('reports the request id when the server sends one', async () => {
    const transport = createTransport({
      baseUrl: BASE_URL,
      fetchImpl: async () =>
        jsonResponse({}, { headers: { 'X-Request-Id': 'req-123' }, status: 500 }),
    });

    const response = await transport({ method: 'get', path: '/v1/me', requiresAuth: true });
    expect(response.requestId).toBe('req-123');
  });

  describe('bodies that are not JSON', () => {
    it('reads a 204 as no body', async () => {
      const transport = createTransport({
        baseUrl: BASE_URL,
        fetchImpl: async () => new Response(null, { status: 204 }),
      });

      const response = await transport({
        method: 'post',
        path: '/v1/auth/logout',
        requiresAuth: false,
        body: { refreshToken: 'r' },
      });
      expect(response).toEqual({ status: 204, body: undefined, requestId: null });
    });

    // A load balancer or captive portal answering HTML is not a transport failure: the
    // status is the real information, and the layer above decides what it means.
    it('keeps the status when the body is HTML', async () => {
      const transport = createTransport({
        baseUrl: BASE_URL,
        fetchImpl: async () =>
          new Response('<html>502 Bad Gateway</html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          }),
      });

      const response = await transport({ method: 'get', path: '/v1/me', requiresAuth: true });
      expect(response).toEqual({ status: 502, body: undefined, requestId: null });
    });
  });

  describe('when the request never gets an answer', () => {
    it('raises NetworkUnavailableError rather than a raw fetch failure', async () => {
      const cause = new TypeError('Network request failed');
      const transport = createTransport({
        baseUrl: BASE_URL,
        fetchImpl: async () => {
          throw cause;
        },
      });

      // A distinct type, because to a sync pass this means "retry later" while an
      // ApiRequestError means "the server has an opinion". Only the latter may ever end
      // a session.
      await expect(
        transport({ method: 'get', path: '/v1/me', requiresAuth: true }),
      ).rejects.toThrow(NetworkUnavailableError);
    });

    it('aborts after the timeout', async () => {
      jest.useFakeTimers();
      const transport = createTransport({
        baseUrl: BASE_URL,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
        timeoutMs: 100,
      });

      const pending = transport({ method: 'get', path: '/v1/me', requiresAuth: true });
      const assertion = expect(pending).rejects.toThrow(NetworkUnavailableError);
      jest.advanceTimersByTime(100);
      await assertion;
      jest.useRealTimers();
    });

    it('lets a caller abort', async () => {
      const controller = new AbortController();
      const transport = createTransport({
        baseUrl: BASE_URL,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      });

      const pending = transport({
        method: 'get',
        path: '/v1/me',
        requiresAuth: true,
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toThrow(NetworkUnavailableError);
    });
  });

  it('has a timeout a mobile radio cannot outlast', () => {
    // Without a ceiling, a sync started on app open can hold a socket for minutes on a
    // bad connection and never retry.
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
