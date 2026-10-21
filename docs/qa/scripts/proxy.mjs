/**
 * The second of §2's three network mechanisms: a proxy that forwards the request and
 * drops the **response**.
 *
 * §2's table is explicit that the three are never interchangeable. Aeroplane mode produces
 * a request the server never saw, which cannot exercise idempotency at all - the retry is
 * the first time the server hears anything. `SYNC-07`, `SYNC-08` and `SYNC-10` need the
 * opposite: a push the server *applied* and the client never heard about. Only something
 * in the path can produce that.
 *
 * It also counts, which is what `SYNC-05` needs. "Exactly one `POST /v1/sync` carries all
 * nine changes" is an assertion about HTTP traffic, and the API logs only failures, so
 * without a tap in the path a two-push drain and a one-push drain look identical.
 *
 *   node docs/qa/scripts/proxy.mjs [--port 3001] [--target http://localhost:3000]
 *
 * Admin surface, on the same port under `/__qa` so a flow can drive it (§2: Maestro's
 * `evalScript` can make HTTP calls, which is why the mechanism this plan needs for
 * `SYNC-07`/`SYNC-08` is the one that happens to be driveable):
 *
 *   GET  /__qa/log        every request seen, with status and whether it was dropped
 *   POST /__qa/drop       drop the response of the next matching request
 *   POST /__qa/reset      clear the log and any armed drop
 *
 * `drop` takes `{ "method": "POST", "path": "/v1/sync", "count": 1 }`; all three are
 * optional and default to "the next request of any shape".
 */

import http from 'node:http';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const PORT = Number(flag('port', 3001));
const TARGET = flag('target', 'http://localhost:3000');

/** @type {{at: string, method: string, path: string, status: number|null, dropped: boolean}[]} */
const log = [];
/** @type {{method?: string, path?: string, count: number}|null} */
let armed = null;

function matches(req) {
  if (armed === null || armed.count <= 0) return false;
  if (armed.method && req.method !== armed.method) return false;
  if (armed.path && !req.url.startsWith(armed.path)) return false;
  return true;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/__qa/')) {
    const route = req.url.slice('/__qa/'.length).split('?')[0];
    if (route === 'log') return json(res, 200, { log, armed });
    if (route === 'reset') {
      log.length = 0;
      armed = null;
      return json(res, 200, { ok: true });
    }
    if (route === 'drop') {
      const body = (await readBody(req)).toString('utf8');
      const parsed = body ? JSON.parse(body) : {};
      armed = { method: parsed.method, path: parsed.path, count: parsed.count ?? 1 };
      return json(res, 200, { armed });
    }
    return json(res, 404, { error: 'unknown admin route' });
  }

  const body = await readBody(req);
  const entry = {
    at: new Date().toISOString(),
    method: req.method,
    path: req.url,
    status: null,
    dropped: false,
    // Captured because several cases assert on *what* crossed the wire, not just that
    // something did: `SYNC-05` needs every category item ahead of every expense item in
    // one body, and a pull that returns rows the device then fails to apply is only
    // distinguishable from a pull that returned nothing by reading the response.
    request: body.length ? body.toString('utf8').slice(0, 20000) : null,
    response: null,
  };
  log.push(entry);

  const drop = matches(req);
  if (drop) armed.count -= 1;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];

  let upstream;
  try {
    upstream = await fetch(TARGET + req.url, {
      method: req.method,
      headers,
      ...(body.length ? { body } : {}),
    });
  } catch (error) {
    entry.status = 502;
    if (!res.writableEnded) json(res, 502, { error: String(error) });
    return;
  }

  const text = await upstream.text();
  entry.status = upstream.status;
  entry.response = text.slice(0, 20000);

  if (drop) {
    // The server has applied it. The client must never learn that, so the socket is
    // destroyed rather than answered - the shape a dropped response actually has.
    entry.dropped = true;
    console.log(`DROP ${req.method} ${req.url} -> ${upstream.status} (applied, answer withheld)`);
    req.socket.destroy();
    return;
  }

  console.log(`${req.method} ${req.url} -> ${upstream.status}`);
  res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
  res.end(text);
});

server.listen(PORT, () => {
  console.log(`qa proxy on :${PORT} -> ${TARGET}`);
});
