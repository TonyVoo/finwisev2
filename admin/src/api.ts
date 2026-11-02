/**
 * The admin API (`docs/design/17-admin.md`) as the page uses it. The shapes mirror
 * `backend/src/admin/schemas.ts`; the backend's tests pin them from that side.
 */

export interface Budget {
  used: number;
  limit: number;
}

export interface Overview {
  server: { version: string; uptimeSeconds: number; time: string };
  database: { sizeBytes: number };
  users: {
    total: number;
    verified: number;
    disabled: number;
    newLast7Days: number;
    newLast30Days: number;
    activeLast7Days: number;
    activeLast30Days: number;
  };
  households: { total: number; memberships: number };
  data: {
    expenses: number;
    categories: number;
    goals: number;
    recurringRules: number;
    receipts: number;
  };
  gemini: { configured: boolean; model: string; receipts: Budget; quickAdd: Budget; recap: Budget };
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  currency: string;
  createdAt: string;
  emailVerified: boolean;
  disabledAt: string | null;
  lastActiveAt: string | null;
  expenseCount: number;
  householdCount: number;
  isAdmin: boolean;
}

export interface UserPage {
  users: AdminUser[];
  nextCursor: string | null;
}

/** The session is over: an expired token, or an account that was disabled. Back to sign-in. */
export class SessionEnded extends Error {
  constructor() {
    super('Your session ended. Sign in again.');
    this.name = 'SessionEnded';
  }
}

/** The server answered with an error; `message` is its own, fit to show. */
export class ApiFailure extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
  }
}

export interface Client {
  login(email: string, password: string): Promise<{ token: string; adminEmail: string }>;
  overview(): Promise<Overview>;
  users(query: { search: string; cursor: string | null }): Promise<UserPage>;
  setDisabled(id: string, disabled: boolean): Promise<AdminUser>;
  remove(id: string, email: string): Promise<void>;
}

interface Answer {
  status: number;
  body: unknown;
}

/** One request. A network failure rejects; everything else resolves with the status and JSON. */
async function send(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<Answer> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return { status: 204, body: null };
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

function errorMessage(answer: Answer, fallback: string): string {
  const error = (answer.body as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === 'string' ? error.message : fallback;
}

/** Throws {@link SessionEnded} on 401 and {@link ApiFailure} on any other non-success. */
function expect(answer: Answer, ok: readonly number[], fallback: string): unknown {
  if (answer.status === 401) throw new SessionEnded();
  if (!ok.includes(answer.status))
    throw new ApiFailure(answer.status, errorMessage(answer, fallback));
  return answer.body;
}

export function createClient(getToken: () => string | null): Client {
  return {
    async login(email, password) {
      const answer = await send('POST', '/v1/auth/login', null, { email, password });
      if (answer.status === 429) {
        throw new ApiFailure(429, 'Too many attempts. Try again in a few minutes.');
      }
      if (answer.status !== 200)
        throw new ApiFailure(answer.status, 'Email or password is not right.');
      const token = (answer.body as { accessToken: string }).accessToken;
      const me = await send('GET', '/admin/api/me', token);
      // Not on the list: the admin routes answer 404, the same as for a path that is not there.
      if (me.status !== 200) throw new ApiFailure(me.status, 'This account is not an admin.');
      return { token, adminEmail: (me.body as { email: string }).email };
    },
    async overview() {
      const answer = await send('GET', '/admin/api/overview', getToken());
      return expect(answer, [200], 'Could not load the overview.') as Overview;
    },
    async users({ search, cursor }) {
      const query = new URLSearchParams({ limit: '25' });
      if (search !== '') query.set('search', search);
      if (cursor !== null) query.set('cursor', cursor);
      const answer = await send('GET', `/admin/api/users?${query.toString()}`, getToken());
      return expect(answer, [200], 'Could not load the accounts.') as UserPage;
    },
    async setDisabled(id, disabled) {
      const answer = await send(
        'POST',
        `/admin/api/users/${id}/${disabled ? 'disable' : 'enable'}`,
        getToken(),
        {},
      );
      return (expect(answer, [200], 'That did not work.') as { user: AdminUser }).user;
    },
    async remove(id, email) {
      const answer = await send('DELETE', `/admin/api/users/${id}`, getToken(), { email });
      expect(answer, [204], 'That did not work.');
    },
  };
}
