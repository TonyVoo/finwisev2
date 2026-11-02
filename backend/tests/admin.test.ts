import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { resetConfigForTests } from '../src/config.ts';
import { getPrisma } from '../src/db/client.ts';
import { AdminOverview, AdminUserList } from '../src/admin/schemas.ts';
import { api, bearer, TEST_PASSWORD } from './support/api.ts';
import { createExpense, createUser, type TestUser } from './support/fixtures.ts';
import { makeHousehold } from './support/spaces.ts';

/**
 * The admin page's API (`docs/design/17-admin.md`): who may use it, what it counts, and how it disables and
 * deletes accounts without ever showing anyone's spending.
 */

function allow(...emails: string[]): void {
  process.env.ADMIN_EMAILS = emails.join(',');
  resetConfigForTests();
}

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
  resetConfigForTests();
});
afterEach(() => {
  delete process.env.ADMIN_EMAILS;
  resetConfigForTests();
});

const as = (user: TestUser) => ({ Authorization: user.auth });
const get = (path: string, user: TestUser) => api().get(`/admin/api${path}`).set(as(user));
const post = (path: string, user: TestUser) =>
  api().post(`/admin/api${path}`).set(as(user)).send({});

async function admin(): Promise<TestUser> {
  const user = await createUser();
  allow(user.user.email);
  return user;
}

describe('who may open it', () => {
  const routes = [
    ['get', '/me'],
    ['get', '/overview'],
    ['get', '/users'],
    ['post', '/users/0192f5a0-0000-7000-8000-000000000001/disable'],
    ['post', '/users/0192f5a0-0000-7000-8000-000000000001/enable'],
    ['delete', '/users/0192f5a0-0000-7000-8000-000000000001'],
  ] as const;

  it('is 401 with no token, like the rest of the API', async () => {
    for (const [method, path] of routes) {
      const response = await api()[method](`/admin/api${path}`);
      expect([path, response.status]).toEqual([path, 401]);
    }
  });

  it('is 404 not_found for a signed-in person who is not listed, on every route', async () => {
    const someone = await createUser();
    allow('somebody.else@example.com');

    for (const [method, path] of routes) {
      const response = await api()[method](`/admin/api${path}`).set(as(someone)).send({});
      expect([path, response.status, response.body.error.code]).toEqual([path, 404, 'not_found']);
    }
  });

  it('is 404 for everyone while no one is listed', async () => {
    const someone = await createUser();

    expect((await get('/me', someone)).status).toBe(404);
  });

  it('lets a listed account in, whatever the case and spacing of the setting', async () => {
    const user = await createUser();
    process.env.ADMIN_EMAILS = `  nobody@example.com , ${user.user.email.toUpperCase()} ,, `;
    resetConfigForTests();

    const response = await get('/me', user);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email: user.user.email });
  });

  it('answers a disabled admin like anyone else disabled: the token stops working', async () => {
    const boss = await admin();
    await getPrisma().user.update({
      where: { id: boss.user.id },
      data: { disabledAt: new Date() },
    });

    expect((await get('/me', boss)).status).toBe(401);
  });
});

describe('GET /admin/api/overview', () => {
  it('counts accounts, households, data and Gemini use, and nothing about anyone’s spending', async () => {
    const boss = await admin();
    const ana = await createUser();
    const bao = await createUser();
    await createExpense(ana, { categoryId: ana.defaultCategory.id, note: 'secret note' });
    await createExpense(ana, { categoryId: ana.defaultCategory.id });
    await getPrisma().user.update({
      where: { id: bao.user.id },
      data: { emailVerifiedAt: new Date(), disabledAt: new Date() },
    });
    await makeHousehold({ owner: ana, members: [bao], name: 'Flat' });

    const response = await get('/overview', boss);

    expect(response.status).toBe(200);
    const overview = AdminOverview.parse(response.body);
    // Three accounts; the household's hidden book is not one of them.
    expect(overview.users).toMatchObject({ total: 3, verified: 1, disabled: 1, newLast7Days: 3 });
    expect(overview.households).toEqual({ total: 1, memberships: 2 });
    expect(overview.data.expenses).toBe(2);
    expect(overview.data.categories).toBeGreaterThanOrEqual(18);
    expect(overview.server.version).toMatch(/\d/);
    expect(overview.database.sizeBytes).toBeGreaterThan(0);
    expect(overview.gemini.receipts.limit).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(response.body)).not.toContain('secret note');
  });

  it('counts an account active when it refreshed its session recently', async () => {
    const boss = await admin();
    const old = await createUser();
    await getPrisma().refreshToken.updateMany({
      where: { userId: old.user.id },
      data: { createdAt: new Date(Date.now() - 40 * 86_400_000) },
    });

    const overview = AdminOverview.parse((await get('/overview', boss)).body);

    // The admin's own sign-up session is recent; the other account's is 40 days old.
    expect(overview.users.activeLast7Days).toBe(1);
    expect(overview.users.activeLast30Days).toBe(1);
  });

  it('does not count deleted rows', async () => {
    const boss = await admin();
    const ana = await createUser();
    const expense = await createExpense(ana, { categoryId: ana.defaultCategory.id });
    await api().delete(`/v1/expenses/${expense.id}`).set(as(ana));

    expect(AdminOverview.parse((await get('/overview', boss)).body).data.expenses).toBe(0);
  });
});

describe('GET /admin/api/users', () => {
  it('lists accounts newest first with who they are, never what they spent', async () => {
    const boss = await admin();
    const ana = await createUser({ currency: 'VND' });
    await createExpense(ana, { categoryId: ana.defaultCategory.id, note: 'private words' });

    const response = await get('/users', boss);

    expect(response.status).toBe(200);
    const { users } = AdminUserList.parse(response.body);
    expect(users.map((u) => u.email)).toEqual([ana.user.email, boss.user.email]);
    expect(users[0]).toMatchObject({
      id: ana.user.id,
      currency: 'VND',
      emailVerified: false,
      disabledAt: null,
      expenseCount: 1,
      householdCount: 0,
      isAdmin: false,
    });
    expect(users[1]).toMatchObject({ isAdmin: true });
    expect(users[0]!.lastActiveAt).not.toBeNull();
    const text = JSON.stringify(response.body);
    for (const leak of [
      'private words',
      'passwordHash',
      'password_hash',
      'refreshToken',
      '$argon2',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('leaves out the hidden books that households keep their rows in', async () => {
    const boss = await admin();
    const ana = await createUser();
    await makeHousehold({ owner: ana });

    const { users } = AdminUserList.parse((await get('/users', boss)).body);

    expect(users).toHaveLength(2);
    expect(users.every((u) => !u.email.endsWith('@households.invalid'))).toBe(true);
    expect(users.find((u) => u.id === ana.user.id)?.householdCount).toBe(1);
  });

  it('searches by part of an email, ignoring case', async () => {
    const boss = await admin();
    const ana = await createUser();
    await createUser();

    const found = AdminUserList.parse(
      (
        await get(
          `/users?search=${encodeURIComponent(ana.user.email.slice(2, 12).toUpperCase())}`,
          boss,
        )
      ).body,
    );

    expect(found.users.map((u) => u.id)).toEqual([ana.user.id]);
  });

  it('pages with a cursor, and says when there is no more', async () => {
    const boss = await admin();
    for (let n = 0; n < 4; n += 1) await createUser();

    const first = AdminUserList.parse((await get('/users?limit=2', boss)).body);
    const second = AdminUserList.parse(
      (await get(`/users?limit=2&cursor=${first.nextCursor}`, boss)).body,
    );
    const third = AdminUserList.parse(
      (await get(`/users?limit=2&cursor=${second.nextCursor}`, boss)).body,
    );

    expect([first.users.length, second.users.length, third.users.length]).toEqual([2, 2, 1]);
    expect(third.nextCursor).toBeNull();
    const ids = [...first.users, ...second.users, ...third.users].map((u) => u.id);
    expect(new Set(ids).size).toBe(5);
  });

  it.each([
    ['limit', '0'],
    ['limit', '500'],
    ['limit', 'x'],
    ['cursor', 'not-an-id'],
  ])('is a validation error for a bad %s (%s)', async (key, value) => {
    const boss = await admin();

    const response = await get(`/users?${key}=${value}`, boss);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('disabling an account', () => {
  it('signs it out everywhere and refuses its sign-in until it is enabled again', async () => {
    const boss = await admin();
    const ana = await createUser();

    const disabled = await post(`/users/${ana.user.id}/disable`, boss);

    expect(disabled.status).toBe(200);
    expect(disabled.body.user.disabledAt).not.toBeNull();
    // Its access token stops working at once...
    expect((await api().get('/v1/me').set(as(ana))).status).toBe(401);
    // ...its refresh token is dead...
    const refreshed = await api().post('/v1/auth/refresh').send({ refreshToken: ana.refreshToken });
    expect(refreshed.status).toBe(401);
    // ...and it cannot sign in, with the same answer as a wrong password.
    const login = await api()
      .post('/v1/auth/login')
      .send({ email: ana.user.email, password: TEST_PASSWORD });
    expect([login.status, login.body.error.code]).toEqual([401, 'invalid_credentials']);

    const enabled = await post(`/users/${ana.user.id}/enable`, boss);
    expect(enabled.status).toBe(200);
    expect(enabled.body.user.disabledAt).toBeNull();
    const again = await api()
      .post('/v1/auth/login')
      .send({ email: ana.user.email, password: TEST_PASSWORD });
    expect(again.status).toBe(200);
    expect(
      (
        await api()
          .get('/v1/me')
          .set({ Authorization: bearer(again.body.accessToken) })
      ).status,
    ).toBe(200);
  });

  it('keeps the account’s data', async () => {
    const boss = await admin();
    const ana = await createUser();
    const expense = await createExpense(ana, { categoryId: ana.defaultCategory.id });

    await post(`/users/${ana.user.id}/disable`, boss);

    expect(await getPrisma().expense.count({ where: { id: expense.id } })).toBe(1);
  });

  it('will not disable the admin themselves, or another admin', async () => {
    const boss = await createUser();
    const other = await createUser();
    allow(boss.user.email, other.user.email);

    for (const target of [boss, other]) {
      const response = await post(`/users/${target.user.id}/disable`, boss);
      expect([response.status, response.body.error.code]).toEqual([403, 'forbidden']);
    }
    expect((await api().get('/v1/me').set(as(other))).status).toBe(200);
  });

  it.each([
    ['an id nobody has', uuidv7()],
    ['something that is not an id', 'nope'],
  ])('is 404 for %s', async (_label, id) => {
    const boss = await admin();

    expect((await post(`/users/${id}/disable`, boss)).status).toBe(404);
  });

  it('is 404 for a household’s hidden book, which is not an account', async () => {
    const boss = await admin();
    const ana = await createUser();
    const home = await makeHousehold({ owner: ana });

    expect((await post(`/users/${home.scopeId}/disable`, boss)).status).toBe(404);
  });
});

describe('deleting an account', () => {
  const remove = (id: string, user: TestUser, email: string | undefined) =>
    api()
      .delete(`/admin/api/users/${id}`)
      .set(as(user))
      .send(email === undefined ? {} : { email });

  it('removes it and its data, when asked with its own email', async () => {
    const boss = await admin();
    const ana = await createUser();
    await createExpense(ana, { categoryId: ana.defaultCategory.id });

    const response = await remove(ana.user.id, boss, ana.user.email);

    expect(response.status).toBe(204);
    expect(await getPrisma().user.count({ where: { id: ana.user.id } })).toBe(0);
    expect(await getPrisma().expense.count({ where: { userId: ana.user.id } })).toBe(0);
  });

  it('refuses without the right email, and deletes nothing', async () => {
    const boss = await admin();
    const ana = await createUser();

    for (const email of [undefined, 'wrong@example.com']) {
      const response = await remove(ana.user.id, boss, email);
      expect([response.status, response.body.error.code]).toEqual([400, 'validation_error']);
    }
    expect(await getPrisma().user.count({ where: { id: ana.user.id } })).toBe(1);
  });

  it('is 409 household_has_members for an owner whose household has others, and keeps everything', async () => {
    const boss = await admin();
    const ana = await createUser();
    const bao = await createUser();
    await makeHousehold({ owner: ana, members: [bao] });

    const response = await remove(ana.user.id, boss, ana.user.email);

    expect([response.status, response.body.error.code]).toEqual([409, 'household_has_members']);
    expect(await getPrisma().user.count({ where: { id: ana.user.id } })).toBe(1);
  });

  it('takes an owner’s empty household with them, as an account deleting itself does', async () => {
    const boss = await admin();
    const ana = await createUser();
    await makeHousehold({ owner: ana });

    expect((await remove(ana.user.id, boss, ana.user.email)).status).toBe(204);
    expect(await getPrisma().household.count()).toBe(0);
  });

  it('will not delete the admin themselves, or another admin', async () => {
    const boss = await createUser();
    const other = await createUser();
    allow(boss.user.email, other.user.email);

    for (const target of [boss, other]) {
      const response = await remove(target.user.id, boss, target.user.email);
      expect([response.status, response.body.error.code]).toEqual([403, 'forbidden']);
      expect(await getPrisma().user.count({ where: { id: target.user.id } })).toBe(1);
    }
  });

  it('is 404 for an unknown id', async () => {
    const boss = await admin();

    expect((await remove(uuidv7(), boss, 'a@example.com')).status).toBe(404);
  });
});

describe('the page', () => {
  let dir: string;

  beforeEach(() => {
    // A stand-in for the React build (`admin/`), so these cases do not depend on having run it.
    dir = mkdtempSync(join(tmpdir(), 'admin-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><title>x</title><script type="module" src="/admin/assets/index-abc.js"></script>',
    );
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
    writeFileSync(join(dir, 'assets', 'index-abc.css'), 'body{}');
    writeFileSync(join(dir, 'secret.txt'), 'not for the web');
    process.env.ADMIN_WEB_DIR = dir;
  });
  afterEach(() => {
    delete process.env.ADMIN_WEB_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('is served without signing in, since it holds no data, and locked down', async () => {
    for (const path of ['/admin', '/admin/']) {
      const response = await api().get(path);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('/admin/assets/index-abc.js');
      const csp = response.headers['content-security-policy'] ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).toContain("frame-ancestors 'none'");
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('serves the built scripts and styles with the right types', async () => {
    const script = await api().get('/admin/assets/index-abc.js');
    const styles = await api().get('/admin/assets/index-abc.css');

    expect([script.status, styles.status]).toEqual([200, 200]);
    expect(script.headers['content-type']).toMatch(/javascript/);
    expect(styles.headers['content-type']).toMatch(/css/);
  });

  it('serves nothing else: no climbing out of the folder, no other files, no dotfiles', async () => {
    for (const path of [
      '/admin/assets/..%2Fsecret.txt',
      '/admin/assets/%2e%2e%2fsecret.txt',
      '/admin/assets/missing.js',
      '/admin/assets/.hidden',
      '/admin/secret.txt',
      '/admin/other.js',
    ]) {
      expect([path, (await api().get(path)).status]).toEqual([path, 404]);
    }
  });

  it('says plainly when it has not been built, instead of failing oddly', async () => {
    process.env.ADMIN_WEB_DIR = join(dir, 'nope');

    const response = await api().get('/admin');

    expect(response.status).toBe(503);
    expect(response.text).toContain('pnpm --filter @expense-tracker/admin build');
  });
});
