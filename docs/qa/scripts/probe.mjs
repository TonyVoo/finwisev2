/**
 * A second API client, for the "observe the server" step of the E2E cases.
 *
 * Several §8 cases end with `GET /v1/sync?since=0` "with a separate API client" — separate
 * because reading the device's own local database would only prove the device agrees with
 * itself. SYNC-01's recorded result had to substitute a direct Postgres read for that step,
 * which left the case's client-minted-id clause unverified: the id was never compared. This
 * talks to the HTTP surface instead, so what a case observes is what the protocol serves.
 *
 * Usage (from the repo root, with the API running):
 *   node docs/qa/scripts/probe.mjs signup <email> [password]
 *   node docs/qa/scripts/probe.mjs login  <email> [password]
 *   node docs/qa/scripts/probe.mjs sync   <email> [since]
 *   node docs/qa/scripts/probe.mjs expenses <email> [--deleted]
 *   node docs/qa/scripts/probe.mjs categories <email>
 *   node docs/qa/scripts/probe.mjs push   <email> <json-file>
 *
 * Sessions are cached in .qa-shots/sessions.json so a later command can reuse one.
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_API_BASE_URL ?? 'http://localhost:3000';
const STORE = path.join('.qa-shots', 'sessions.json');
const PASSWORD = 'qa-password-123';

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}

async function call(method, route, { body, token } = {}) {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** A fresh access token every time: these cases run long enough to outlive one. */
async function session(email) {
  const store = readStore();
  const saved = store[email];
  const password = saved?.password ?? PASSWORD;
  const res = await call('POST', '/v1/auth/login', { body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`login ${email} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  store[email] = { ...saved, password, ...res.body };
  writeStore(store);
  return res.body;
}

const [, , command, ...rest] = process.argv;

const commands = {
  async signup([email, password = PASSWORD]) {
    const res = await call('POST', '/v1/auth/signup', { body: { email, password } });
    if (res.status === 201) {
      const store = readStore();
      store[email] = { password, ...res.body };
      writeStore(store);
    }
    return res;
  },

  async login([email, password = PASSWORD]) {
    const store = readStore();
    store[email] = { ...(store[email] ?? {}), password };
    writeStore(store);
    return { status: 200, body: await session(email) };
  },

  async sync([email, since = '0']) {
    const s = await session(email);
    return call('GET', `/v1/sync?since=${since}`, { token: s.accessToken });
  },

  async expenses([email, flag]) {
    const s = await session(email);
    const q = flag === '--deleted' ? '?includeDeleted=true' : '';
    return call('GET', `/v1/expenses${q}`, { token: s.accessToken });
  },

  async categories([email]) {
    const s = await session(email);
    return call('GET', '/v1/categories', { token: s.accessToken });
  },

  async push([email, file]) {
    const s = await session(email);
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    return call('POST', '/v1/sync', { body, token: s.accessToken });
  },

  async me([email]) {
    const s = await session(email);
    return call('GET', '/v1/me', { token: s.accessToken });
  },
};

if (!commands[command]) {
  console.error(`unknown command ${command}; one of ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}

const result = await commands[command](rest);
console.log(JSON.stringify(result, null, 2));
