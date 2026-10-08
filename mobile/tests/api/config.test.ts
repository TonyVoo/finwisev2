import { InvalidApiBaseUrlError, MissingApiBaseUrlError, resolveApiBaseUrl } from '@/api/config';

describe('resolveApiBaseUrl', () => {
  it('prefers the build-time env var over app.json', () => {
    // `EXPO_PUBLIC_*` is the per-build knob (a local .env, then EAS build env vars), so
    // it has to win over the value checked into app.json.
    expect(
      resolveApiBaseUrl({
        fromEnv: 'https://api.staging.test',
        fromAppConfig: 'https://api.prod.test',
      }),
    ).toBe('https://api.staging.test');
  });

  it('falls back to app.json', () => {
    expect(resolveApiBaseUrl({ fromAppConfig: 'https://api.prod.test' })).toBe(
      'https://api.prod.test',
    );
  });

  it('strips trailing slashes', () => {
    // Route paths in `@expense-tracker/shared` start with `/v1`, so a trailing slash
    // here would produce `//v1/...`.
    expect(resolveApiBaseUrl({ fromEnv: 'https://api.test//' })).toBe('https://api.test');
  });

  it('keeps a path prefix, for an API behind a proxy', () => {
    expect(resolveApiBaseUrl({ fromEnv: 'https://example.test/api' })).toBe(
      'https://example.test/api',
    );
  });

  it('accepts the emulator loopback addresses', () => {
    // The three a developer actually needs; see mobile/.env.example.
    expect(resolveApiBaseUrl({ fromEnv: 'http://localhost:3000' })).toBe('http://localhost:3000');
    expect(resolveApiBaseUrl({ fromEnv: 'http://10.0.2.2:3000' })).toBe('http://10.0.2.2:3000');
    expect(resolveApiBaseUrl({ fromEnv: 'http://192.168.1.20:3000' })).toBe(
      'http://192.168.1.20:3000',
    );
  });

  describe('failing loudly', () => {
    /**
     * Deliberately not defaulted to localhost. A production build quietly pointing at a
     * developer's machine presents as "the app is permanently offline" - which in an
     * offline-first app is the one symptom nobody investigates, because it looks like
     * the feature working.
     */
    it('throws when nothing is configured', () => {
      expect(() => resolveApiBaseUrl({})).toThrow(MissingApiBaseUrlError);
      expect(() => resolveApiBaseUrl({ fromEnv: '   ' })).toThrow(MissingApiBaseUrlError);
    });

    it('throws on a relative URL', () => {
      expect(() => resolveApiBaseUrl({ fromEnv: '/api' })).toThrow(InvalidApiBaseUrlError);
    });

    it('throws on a protocol that is not http or https', () => {
      expect(() => resolveApiBaseUrl({ fromEnv: 'ftp://api.test' })).toThrow(
        /unsupported protocol/,
      );
      expect(() => resolveApiBaseUrl({ fromEnv: 'expensetracker://api' })).toThrow(
        /unsupported protocol/,
      );
    });

    it('throws when the value carries a query or fragment', () => {
      // These would be silently dropped once a path and query are appended.
      expect(() => resolveApiBaseUrl({ fromEnv: 'https://api.test?debug=1' })).toThrow(
        /query string or fragment/,
      );
      expect(() => resolveApiBaseUrl({ fromEnv: 'https://api.test#x' })).toThrow(
        /query string or fragment/,
      );
    });
  });
});
