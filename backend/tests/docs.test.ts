import { describe, expect, it } from 'vitest';
import { api } from './support/api.ts';

describe('GET /docs', () => {
  it('serves the Swagger UI page without a token', async () => {
    const response = await api().get('/docs');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('SwaggerUIBundle');
    expect(response.text).toContain('/docs/openapi.yaml');
  });

  it('serves the contract file the page points at', async () => {
    const response = await api().get('/docs/openapi.yaml');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/yaml/);
    expect(response.text).toMatch(/^openapi: 3\./m);
    expect(response.text).toContain('/v1/health:');
  });
});
