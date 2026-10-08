import Constants from 'expo-constants';

/**
 * Where the API lives, per environment.
 *
 * Two sources, in precedence order:
 *
 * 1. `EXPO_PUBLIC_API_BASE_URL`. `EXPO_PUBLIC_*` variables are inlined into the bundle
 *    at build time, so this is the per-build knob: a local `.env` in development, EAS
 *    build env vars for preview and production. The reference below has to stay a
 *    literal static member expression or the inlining does not happen.
 * 2. `expo.extra.apiBaseUrl` in `app.json`, for a value checked into the config rather
 *    than supplied by the build environment.
 *
 * Nothing secret belongs in either: both ship inside the app bundle, which is readable.
 */

export class MissingApiBaseUrlError extends Error {
  constructor() {
    super(
      'No API base URL configured. Set EXPO_PUBLIC_API_BASE_URL (see mobile/.env.example) ' +
        'or expo.extra.apiBaseUrl in app.json.',
    );
    this.name = 'MissingApiBaseUrlError';
  }
}

export class InvalidApiBaseUrlError extends Error {
  constructor(value: string, reason: string) {
    super(`Invalid API base URL ${JSON.stringify(value)}: ${reason}`);
    this.name = 'InvalidApiBaseUrlError';
  }
}

export interface ApiBaseUrlSources {
  /** Value of `EXPO_PUBLIC_API_BASE_URL`. */
  readonly fromEnv?: string | undefined;
  /** Value of `expo.extra.apiBaseUrl`. */
  readonly fromAppConfig?: string | undefined;
}

function readSources(): ApiBaseUrlSources {
  const extra = Constants.expoConfig?.extra;
  const fromAppConfig = extra?.['apiBaseUrl'];
  return {
    fromEnv: process.env.EXPO_PUBLIC_API_BASE_URL,
    fromAppConfig: typeof fromAppConfig === 'string' ? fromAppConfig : undefined,
  };
}

/**
 * Resolve the base URL, without the `/v1` prefix and without a trailing slash - route
 * paths in `@expense-tracker/shared` already carry the prefix, so keeping it out of the
 * base URL means the two can never both supply it.
 *
 * Fails loudly at startup rather than defaulting to something like `localhost`: a
 * production build that silently points at a developer's machine looks like "the app is
 * permanently offline", which in an offline-first app is exactly the symptom nobody
 * investigates.
 */
export function resolveApiBaseUrl(sources: ApiBaseUrlSources = readSources()): string {
  const raw = (sources.fromEnv ?? sources.fromAppConfig ?? '').trim();
  if (raw === '') {
    throw new MissingApiBaseUrlError();
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidApiBaseUrlError(raw, 'not an absolute URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidApiBaseUrlError(raw, `unsupported protocol ${parsed.protocol}`);
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new InvalidApiBaseUrlError(raw, 'must not carry a query string or fragment');
  }

  return raw.replace(/\/+$/, '');
}
