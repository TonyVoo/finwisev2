import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import type { AdminUser, Overview } from '../src/api.ts';

/**
 * The admin page against a fake of the admin API (`docs/design/17-admin.md`): what it shows, what it asks the
 * server to do, and what it never does with server text.
 */

const OVERVIEW: Overview = {
  server: { version: '0.1.0', uptimeSeconds: 7200, time: '2026-11-02T04:00:00.000Z' },
  database: { sizeBytes: 5_242_880 },
  users: {
    total: 3,
    verified: 1,
    disabled: 1,
    newLast7Days: 2,
    newLast30Days: 3,
    activeLast7Days: 2,
    activeLast30Days: 3,
  },
  households: { total: 1, memberships: 2 },
  trend: {
    days: Array.from({ length: 14 }, (_, n) => `2026-10-${String(20 + n).padStart(2, '0')}`),
    signups: [0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0],
    active: [0, 0, 1, 0, 1, 1, 0, 2, 1, 1, 0, 2, 2, 2],
  },
  data: { expenses: 120, categories: 18, goals: 2, recurringRules: 1, receipts: 4 },
  gemini: {
    configured: true,
    model: 'gemini-test',
    receipts: { used: 3, limit: 500 },
    quickAdd: { used: 0, limit: 200 },
    recap: { used: 1, limit: 100 },
  },
};

function user(over: Partial<AdminUser> & { id: string; email: string }): AdminUser {
  return {
    displayName: null,
    currency: 'USD',
    createdAt: '2026-10-01T00:00:00.000Z',
    emailVerified: false,
    disabledAt: null,
    lastActiveAt: '2026-11-01T00:00:00.000Z',
    expenseCount: 5,
    householdCount: 0,
    isAdmin: false,
    ...over,
  };
}

interface Fake {
  users: AdminUser[];
  calls: Array<{ method: string; path: string; auth: string | null; body: unknown }>;
  loginStatus: number;
  meStatus: number;
  sessionEnded: boolean;
  pageSize: number;
}

let fake: Fake;

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fake = {
    users: [
      user({
        id: '0192f5a0-0000-7000-8000-000000000001',
        email: 'admin@example.com',
        isAdmin: true,
      }),
      user({
        id: '0192f5a0-0000-7000-8000-000000000002',
        email: 'ana@example.com',
        displayName: 'Ana',
      }),
      user({
        id: '0192f5a0-0000-7000-8000-000000000003',
        email: 'bao@example.com',
        disabledAt: '2026-10-30T00:00:00.000Z',
      }),
    ],
    calls: [],
    loginStatus: 200,
    meStatus: 200,
    sessionEnded: false,
    pageSize: 25,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      fake.calls.push({ method, path, auth: headers.Authorization ?? null, body });

      if (path === '/v1/auth/login') {
        return fake.loginStatus === 200
          ? json(200, { accessToken: 'tok-1' })
          : json(fake.loginStatus, { error: { code: 'invalid_credentials', message: 'x' } });
      }
      if (path.startsWith('/admin/api') && fake.sessionEnded && path !== '/admin/api/me') {
        return json(401, { error: { code: 'token_invalid', message: 'x' } });
      }
      if (path === '/admin/api/me') {
        return fake.meStatus === 200
          ? json(200, { email: 'admin@example.com' })
          : json(404, { error: { code: 'not_found', message: 'Not found.' } });
      }
      if (path === '/admin/api/overview') return json(200, OVERVIEW);
      if (path.startsWith('/admin/api/users?')) {
        const query = new URLSearchParams(path.split('?')[1]);
        const search = query.get('search')?.toLowerCase() ?? '';
        const matching = fake.users.filter((u) => u.email.includes(search));
        const start = query.get('cursor') === null ? 0 : Number(query.get('cursor'));
        const page = matching.slice(start, start + fake.pageSize);
        const next = start + fake.pageSize < matching.length ? String(start + fake.pageSize) : null;
        return json(200, { users: page, nextCursor: next });
      }
      const toggle = /^\/admin\/api\/users\/(.+)\/(disable|enable)$/.exec(path);
      if (toggle) {
        const target = fake.users.find((u) => u.id === toggle[1])!;
        target.disabledAt = toggle[2] === 'disable' ? '2026-11-02T00:00:00.000Z' : null;
        return json(200, { user: target });
      }
      const removal = /^\/admin\/api\/users\/(.+)$/.exec(path);
      if (removal && method === 'DELETE') {
        fake.users = fake.users.filter((u) => u.id !== removal[1]);
        return json(204, null);
      }
      throw new Error(`unexpected request ${method} ${path}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function signIn() {
  const ui = userEvent.setup();
  render(<App />);
  await ui.type(screen.getByLabelText('Email'), 'admin@example.com');
  await ui.type(screen.getByLabelText('Password'), 'correct-horse-battery');
  await ui.click(screen.getByRole('button', { name: 'Sign in' }));
  return ui;
}

describe('signing in', () => {
  it('shows the overview and the accounts, and sends the token only to the admin API', async () => {
    await signIn();

    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('Gemini today')).toBeInTheDocument();
    expect(screen.getByText('3 of 500 today')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    const adminCalls = fake.calls.filter((call) => call.path.startsWith('/admin/api'));
    expect(adminCalls.length).toBeGreaterThan(2);
    expect(adminCalls.every((call) => call.auth === 'Bearer tok-1')).toBe(true);
    expect(fake.calls.find((call) => call.path === '/v1/auth/login')?.auth).toBeNull();
  });

  it('keeps the token out of storage, so closing the tab signs out', async () => {
    await signIn();
    await screen.findByText('120');

    expect(JSON.stringify({ ...localStorage })).not.toContain('tok-1');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('tok-1');
    expect(document.cookie).not.toContain('tok-1');
  });

  it('says so for a wrong password, and clears the field', async () => {
    fake.loginStatus = 401;
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is not right.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('says so for an account that is not an admin, and shows nothing else', async () => {
    fake.meStatus = 404;
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('This account is not an admin.');
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });

  it('says the server may be waking up when it cannot be reached', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network'));
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('waking up');
  });

  it('returns to sign-in, with a note, when the session ends', async () => {
    const ui = await signIn();
    await screen.findByText('120');

    fake.sessionEnded = true;
    await ui.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your session ended');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs out from the button', async () => {
    const ui = await signIn();
    await screen.findByText('120');

    await ui.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('the accounts', () => {
  it('marks admins and disabled accounts, and offers no actions on an admin', async () => {
    await signIn();
    const adminRow = (await screen.findByText('admin@example.com', { selector: '.name' })).closest(
      'tr',
    )!;
    const bao = screen.getByText('bao@example.com', { selector: '.name' }).closest('tr')!;

    expect(within(adminRow).getByText('admin')).toBeInTheDocument();
    expect(within(adminRow).queryByRole('button')).not.toBeInTheDocument();
    expect(within(bao).getByText('disabled')).toBeInTheDocument();
    expect(within(bao).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('disables and enables an account, and refreshes the counts', async () => {
    const ui = await signIn();
    const ana = (await screen.findByText(/ana@example.com/)).closest('tr')!;

    await ui.click(within(ana).getByRole('button', { name: 'Disable' }));

    expect(await within(ana).findByText('disabled')).toBeInTheDocument();
    expect(
      fake.calls.some((call) =>
        call.path.endsWith('/0192f5a0-0000-7000-8000-000000000002/disable'),
      ),
    ).toBe(true);
    await ui.click(within(ana).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(within(ana).queryByText('disabled')).not.toBeInTheDocument());
    expect(
      fake.calls.filter((call) => call.path === '/admin/api/overview').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('writes server text as text, never as HTML', async () => {
    fake.users.push(
      user({
        id: '0192f5a0-0000-7000-8000-000000000009',
        email: '<img src=x onerror=alert(1)>@example.com',
      }),
    );
    await signIn();

    expect(
      await screen.findByText('<img src=x onerror=alert(1)>@example.com', { selector: '.name' }),
    ).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('searches by email', async () => {
    const ui = await signIn();
    await screen.findByText(/ana@example.com/);

    await ui.type(screen.getByLabelText('Search by email'), 'bao');
    await ui.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.queryByText(/ana@example.com/)).not.toBeInTheDocument());
    expect(screen.getByText('bao@example.com', { selector: '.name' })).toBeInTheDocument();
  });

  it('loads the next page on request, and stops offering it at the end', async () => {
    fake.pageSize = 2;
    const ui = await signIn();
    await screen.findByText(/ana@example.com/);
    expect(screen.queryByText('bao@example.com', { selector: '.name' })).not.toBeInTheDocument();

    await ui.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('bao@example.com', { selector: '.name' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('deleting an account', () => {
  async function openDialog() {
    const ui = await signIn();
    const ana = (await screen.findByText(/ana@example.com/)).closest('tr')!;
    await ui.click(within(ana).getByRole('button', { name: 'Delete' }));
    return ui;
  }

  it('asks for the email, and only enables the button when it matches', async () => {
    const ui = await openDialog();
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });

    expect(confirm).toBeDisabled();
    await ui.type(
      within(dialog).getByLabelText('Type their email to confirm'),
      'wrong@example.com',
    );
    expect(confirm).toBeDisabled();
    await ui.clear(within(dialog).getByLabelText('Type their email to confirm'));
    await ui.type(within(dialog).getByLabelText('Type their email to confirm'), 'ANA@example.com');
    expect(confirm).toBeEnabled();
  });

  it('sends the email, then drops the row', async () => {
    const ui = await openDialog();
    const dialog = screen.getByRole('dialog');

    await ui.type(within(dialog).getByLabelText('Type their email to confirm'), 'ana@example.com');
    await ui.click(within(dialog).getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(screen.queryByText(/ana@example.com/)).not.toBeInTheDocument());
    const call = fake.calls.find((c) => c.method === 'DELETE')!;
    expect(call.path).toBe('/admin/api/users/0192f5a0-0000-7000-8000-000000000002');
    expect(call.body).toEqual({ email: 'ana@example.com' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('can be cancelled, and deletes nothing', async () => {
    const ui = await openDialog();

    await ui.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });
});
