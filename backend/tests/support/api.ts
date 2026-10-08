import type { AuthResponse } from '@expense-tracker/shared';
import supertest from 'supertest';
import { createApp } from '../../src/app.ts';

/**
 * Test client. Drives the real app through HTTP, in-process.
 *
 * supertest against `createApp()` rather than calling services directly, because most of
 * what this task promises — the error envelope, the 415, the `Bearer` parsing, the
 * status codes in the contract — only exists at the HTTP layer. A service-level test
 * would pass with the middleware unmounted.
 */

const app = createApp();

export function api(): supertest.Agent {
  return supertest.agent(app);
}

/** A password that satisfies `LIMITS.PASSWORD_MIN`. Nothing secret about it. */
export const TEST_PASSWORD = 'correct-horse-battery';

let emailCounter = 0;

/** A fresh email per call, so no test depends on another's cleanup. */
export function uniqueEmail(label = 'user'): string {
  emailCounter += 1;
  return `${label}-${emailCounter}-${Date.now()}@example.com`;
}

export interface SignedUpUser extends AuthResponse {
  readonly password: string;
}

/** Sign up through the real endpoint and return the session it issued. */
export async function signUp(
  overrides: { email?: string; password?: string; currency?: string } = {},
): Promise<SignedUpUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? TEST_PASSWORD;

  const response = await api()
    .post('/v1/auth/signup')
    .send({ email, password, ...(overrides.currency ? { currency: overrides.currency } : {}) });

  if (response.status !== 201) {
    throw new Error(`signUp helper failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { ...(response.body as AuthResponse), password };
}

/** `Authorization` header value for an access token. */
export function bearer(accessToken: string): string {
  return `Bearer ${accessToken}`;
}
