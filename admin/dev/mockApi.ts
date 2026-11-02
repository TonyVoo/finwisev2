import type { ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * A stand-in for the admin API, for designing the page without a backend: `ADMIN_MOCK=1 pnpm dev`. Any
 * email and password sign in. Never part of a build.
 */
export function mockApi(): Plugin {
  const day = 86_400_000;
  const now = Date.now();
  const names = [
    'ana',
    'bao',
    'chi',
    'dung',
    'em',
    'phuc',
    'giang',
    'hoa',
    'khang',
    'linh',
    'minh',
    'nga',
  ];
  let users = names.map((name, index) => ({
    id: `0192f5a0-0000-7000-8000-0000000000${String(index + 10)}`,
    email: `${name}@example.com`,
    displayName: index % 3 === 0 ? name.toUpperCase() : null,
    currency: index % 4 === 0 ? 'VND' : 'USD',
    createdAt: new Date(now - (index + 1) * 3 * day).toISOString(),
    emailVerified: index % 2 === 0,
    disabledAt: index === 4 ? new Date(now - day).toISOString() : null,
    lastActiveAt: index === 7 ? null : new Date(now - index * day).toISOString(),
    expenseCount: (index * 37) % 210,
    householdCount: index % 5 === 0 ? 2 : index % 3,
    isAdmin: index === 0,
  }));

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(body === null ? '' : JSON.stringify(body));
  };

  return {
    name: 'admin-mock-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        if (path === '/v1/auth/login') return json(res, 200, { accessToken: 'mock' });
        if (!path.startsWith('/admin/api')) return next();
        if (path === '/admin/api/me') return json(res, 200, { email: 'ana@example.com' });
        if (path === '/admin/api/overview') {
          return json(res, 200, {
            server: { version: '0.1.0', uptimeSeconds: 187_000, time: new Date().toISOString() },
            database: { sizeBytes: 9_437_184 },
            users: {
              total: users.length,
              verified: 6,
              disabled: users.filter((u) => u.disabledAt).length,
              newLast7Days: 3,
              newLast30Days: 11,
              activeLast7Days: 7,
              activeLast30Days: 10,
            },
            households: { total: 4, memberships: 7 },
            trend: {
              days: Array.from({ length: 14 }, (_, n) =>
                new Date(now - (13 - n) * day).toISOString().slice(0, 10),
              ),
              signups: [0, 1, 0, 0, 2, 1, 0, 0, 1, 3, 0, 1, 2, 3],
              active: [3, 4, 4, 5, 3, 6, 7, 6, 5, 7, 8, 7, 9, 10],
            },
            data: { expenses: 1284, categories: 96, goals: 9, recurringRules: 14, receipts: 23 },
            gemini: {
              configured: true,
              model: 'gemini-3.5-flash-lite',
              receipts: { used: 41, limit: 500 },
              quickAdd: { used: 118, limit: 200 },
              recap: { used: 0, limit: 100 },
            },
          });
        }
        if (path === '/admin/api/users' && req.method === 'GET') {
          const search = (url.searchParams.get('search') ?? '').toLowerCase();
          const matching = users.filter((u) => u.email.includes(search));
          return json(res, 200, { users: matching, nextCursor: null });
        }
        const toggle = /^\/admin\/api\/users\/(.+)\/(disable|enable)$/.exec(path);
        if (toggle) {
          users = users.map((u) =>
            u.id === toggle[1]
              ? { ...u, disabledAt: toggle[2] === 'disable' ? new Date().toISOString() : null }
              : u,
          );
          return json(res, 200, { user: users.find((u) => u.id === toggle[1]) });
        }
        const removal = /^\/admin\/api\/users\/(.+)$/.exec(path);
        if (removal && req.method === 'DELETE') {
          users = users.filter((u) => u.id !== removal[1]);
          return json(res, 204, null);
        }
        return json(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
      });
    },
  };
}
