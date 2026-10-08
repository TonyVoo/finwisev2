import { HealthResponse } from '@expense-tracker/shared';
import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';

describe('GET /v1/health', () => {
  it('reports ok with a live database, in the contract shape', async () => {
    const response = await api().get('/v1/health');

    expect(response.status).toBe(200);
    // Parsed against the contract schema rather than field-by-field: this is the
    // assertion that fails if the handler and `shared/` ever drift.
    expect(() => HealthResponse.parse(response.body)).not.toThrow();
    expect(response.body).toMatchObject({ status: 'ok', db: 'up' });
  });

  it('needs no access token', async () => {
    const response = await api().get('/v1/health');
    expect(response.status).toBe(200);
  });

  it('echoes a request id on every response', async () => {
    const response = await api().get('/v1/health');
    expect(response.headers['x-request-id']).toMatch(/\S/);
  });

  it('reuses a sane client-supplied request id', async () => {
    const response = await api().get('/v1/health').set('X-Request-Id', 'trace-abc-123');
    expect(response.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('replaces a junk client-supplied request id rather than echoing it into the logs', async () => {
    const response = await api().get('/v1/health').set('X-Request-Id', 'has spaces and <angles>');
    expect(response.headers['x-request-id']).not.toBe('has spaces and <angles>');
    expect(response.headers['x-request-id']).toMatch(/\S/);
  });
});

describe('unknown routes', () => {
  it('answers the contract error envelope, not an Express HTML page', async () => {
    const response = await api().get('/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'not_found', message: expect.any(String) },
    });
  });

  it('is 401 rather than 404 for an unknown /v1 path without credentials', async () => {
    // The authenticated router is mounted on `/v1`, so `requireAuth` runs before the
    // 404 handler is reached. Deliberate: answering 404 would tell a caller holding no
    // credentials which paths exist.
    const response = await api().get('/v1/not-a-route');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });
});
